"""Telling a coach their report is ready, when it becomes ready.

This used to happen in the endpoint the app polls, on the reasoning that a
notification written in one place cannot be forgotten in the six places a job
is marked finished. The instinct was right and the place was wrong, because it
made the message depend on the coach already looking:

  a report finished while they were away was announced when they next opened
  the app, so the email arrived at the one moment it could not tell them
  anything they were not about to see;

  and the poll only looks twelve hours back, so a report that finished
  overnight and was opened the next afternoon was never announced at all. Not
  late. Never.

So it stays one function, and that function is called where a job finishes.
`announce` is idempotent on `job.announced`, so the polling endpoint still
calls it as a backstop for anything that finished without getting through here,
and a job cannot be announced twice.

Nothing is sent from here directly: `_coach_notify` registers the send on the
session's commit, so a job whose result fails to save does not produce mail
saying it is ready.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from . import models, report_titles

log = logging.getLogger(__name__)

# The in-app title for each kind of job. Lives here rather than in the routes
# because the announcement does too.
JOB_KIND_LABELS = {
    "eval": "Player evaluation",
    "eval_text": "Player evaluation",
    "team_report": "Team Eval",
    "packet": "Game report packet",
    "training": "Training program",
    "scouting": "Scouting report",
    "game_report_full": "Game report",
    "clip": "Film analysis",
}


def label_for(kind: str) -> str:
    return JOB_KIND_LABELS.get(kind or "", "Report")


def announce(db: Session, job: "models.GenerationJob | None") -> bool:
    """Write and queue the "your report is ready" notification for one job.

    Returns whether anything was written, so a caller that batches commits
    knows if it has to. Never raises: a report that finished must not be
    reported as failed because the message about it could not be built.
    """
    if job is None or job.status not in ("done", "error") or job.announced:
        return False
    try:
        from .routes.staff_sharing import _coach_notify

        label = label_for(job.kind)
        done = job.status == "done"
        _coach_notify(
            db, job.coach_id,
            title=f"{label} {'ready' if done else 'failed'}",
            body=(f"Your {label.lower()} is ready to read." if done
                  else (job.error or f"Your {label.lower()} could not be finished.")),
            ref_id=job.result_id,
            ntype="job_done" if done else "job_error",
            key="notifs.jobDone" if done else "notifs.jobFailed",
            # `item` names the document the job produced, and falls back to the
            # kind rather than being left out: copy with an unfilled
            # placeholder is not sent at all, so a job whose result cannot be
            # named would go from a vague email to no email.
            params={"kind": job.kind, "label": label,
                    "item": report_titles.qualified_for_job(
                        db, job.kind, job.result_id) or job.kind,
                    "reason": (job.error or "")[:200]},
        )
        job.announced = True
        return True
    except Exception:
        log.warning("Could not announce job %s", getattr(job, "id", "?"),
                    exc_info=True)
        return False


def announce_and_commit(job_id: int) -> None:
    """The same thing, on its own session, for a background worker.

    A worker that has just marked a job finished has closed the session it did
    that on, so this opens its own rather than reaching for a dead one.
    """
    from .database import SessionLocal

    db = SessionLocal()
    try:
        if announce(db, db.get(models.GenerationJob, job_id)):
            db.commit()
    except Exception:
        db.rollback()
        log.warning("Could not announce job %s", job_id, exc_info=True)
    finally:
        db.close()
