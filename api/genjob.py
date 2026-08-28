"""Running a report on a job instead of on the request that asked for it.

WHY EVERY LONG REPORT NEEDS THIS

A report is minutes of work answered over one HTTP request, and the app gives up
on a request after two minutes. When it does, nothing has failed — the server is
still writing, and it saves the report a minute later with nobody watching — but
the coach is shown an error, and because a timeout carries no response body,
they are shown the most generic one the screen has.

That is what happened to the game packet: no POST in the server log at all,
because uvicorn logs a request when it finishes, and this one had not.

The fix is not a longer timeout. It is to stop making the request wait: start a
GenerationJob, hand back its id, and let the app follow it. That also buys
things a held request could never have — a deploy mid-report no longer throws it
away (the job's own resume machinery picks it up), the coach can leave the
screen, and there is somewhere for progress to be reported from.

This module is the small amount of shared machinery for it, so each report type
is a worker function and a two-line endpoint rather than its own copy.
"""
from __future__ import annotations

import json
from typing import Callable

from .database import SessionLocal
from . import job_notify, models


def start(db, coach_id: int, kind: str, payload: dict | None) -> models.GenerationJob:
    """Create the job row a caller hands back as {"job_id": ...}."""
    job = models.GenerationJob(
        coach_id=coach_id, kind=kind, status="processing",
        # A percentage from the first poll, so the bar never starts blank.
        progress="job:writing:0",
        # None, not "null": revive_if_stalled treats any stored payload as
        # resumable, and the string "null" is truthy. A job that cannot be
        # resumed must have no payload at all so it is closed with a reason.
        payload=json.dumps(payload) if payload is not None else None,
        attempts=1,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def words_reporter(job_id: int) -> Callable[[int], None]:
    """Turn "how many words have been written" into progress the app can render.

    `job:writing:NN` is the code film synthesis already uses, so every screen
    that can show a film's progress can show a report's without a new wire
    format — and an older browser tab that does not know the code says
    "Working…" rather than printing it at a coach.
    """
    FULL = 3000        # words in a full report
    TAIL = 300         # words per further point once past it

    def report(words: int) -> None:
        pct = (round(90 * words / FULL) if words <= FULL
               else min(99, 90 + (words - FULL) // TAIL))
        db = SessionLocal()
        try:
            job = db.get(models.GenerationJob, job_id)
            if job:
                job.progress = f"job:writing:{min(pct, 99)}"
                db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

    return report


def run(job_id: int, work: Callable[[], int | None]) -> None:
    """Run `work`, and make sure the job says what happened either way.

    `work` returns the id to hand back as the job's result. It must open and
    close its own sessions: a report takes minutes, and a session held across
    all of them is an idle transaction PostgreSQL will close out from under the
    write at the end — which is how a finished analysis once failed to save and
    left the job saying "Synthesizing report" forever.
    """
    try:
        result_id = work()
        db = SessionLocal()
        try:
            job = db.get(models.GenerationJob, job_id)
            if job:
                job.status = "done"
                if result_id is not None:
                    job.result_id = result_id
                # Told now, not when the coach next opens the app. Announcing
                # on the poll meant the email arrived at the one moment it
                # could tell them nothing they were not about to see, and a
                # report that finished overnight was never announced at all.
                job_notify.announce(db, job)
            db.commit()
        finally:
            db.close()
    except Exception as exc:
        db = SessionLocal()
        try:
            job = db.get(models.GenerationJob, job_id)
            if job:
                job.status = "error"
                # The reason, not "something went wrong" — this is what the
                # coach is shown, and "your credit balance is too low" is
                # actionable in a way that a generic failure is not.
                job.error = _reason(exc)[:500]
                job_notify.announce(db, job)
            db.commit()
        finally:
            db.close()


def _reason(exc: Exception) -> str:
    """The detail out of an HTTPException, or the exception itself."""
    detail = getattr(exc, "detail", None)
    return str(detail) if detail else str(exc)
