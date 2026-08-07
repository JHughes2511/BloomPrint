"""Releasing film from storage when nothing needs it any more.

Film is the only thing in this app measured in gigabytes, and it is the only
thing a coach pays for by the month. Deleting the record that pointed at it
used to leave the bytes in the bucket for good: a deleted packet or evaluation
freed nothing at all.

Two rules make releasing it safe.

The FILE goes, the REPORT stays. Deleting a packet does not throw away the
breakdown the film produced — that text is the work, and it is kilobytes. So
the row keeps its analysis and simply stops pointing at a file.

Nothing is deleted while something else still points at it. The same upload can
be referenced from more than one place: an evaluation's film also appears in
the player's film catalog. Releasing one of them must not break the other, so a
ref is only removed from storage once no live row references it.
"""
from typing import Iterable

from sqlalchemy.orm import Session

from . import models, storage


def _still_referenced(db: Session, ref: str) -> bool:
    """Does any live row still point at this stored file?"""
    if not ref:
        return False
    for model in (models.Evaluation, models.PlayerVideo, models.GameReportClip):
        q = db.query(model).filter(model.video_path == ref)
        # Soft-deleted rows count: a hidden evaluation is meant to be
        # recoverable, so something else still needs this file.
        if q.execution_options(include_deleted=True).first() is not None:
            return True
    return False


def release(db: Session, refs: Iterable[str]) -> int:
    """Delete stored film that nothing points at any more.

    Call AFTER the pointing rows have been cleared and flushed, so the
    reference check sees the world as it will be. Returns how many files were
    actually removed.
    """
    freed = 0
    for ref in {r for r in refs if r}:
        if _still_referenced(db, ref):
            continue
        if storage.delete(ref):
            freed += 1
    return freed


def release_for_game_report(db: Session, report: "models.GameReport") -> int:
    """Free the film attached to a packet, keeping each clip's breakdown."""
    clips = db.query(models.GameReportClip).filter_by(game_report_id=report.id).all()
    refs = [c.video_path for c in clips if c.video_path]
    for c in clips:
        # Empty, not NULL: the column is NOT NULL and SQLite cannot drop that
        # without rebuilding the table. Every reader already treats an empty ref
        # as "no film", so this needs no schema change on either backend.
        c.video_path = ""
    db.flush()
    return release(db, refs)


def release_for_evaluation(db: Session, ev: "models.Evaluation") -> int:
    """Free an evaluation's film, keeping the evaluation itself."""
    ref = ev.video_path
    ev.video_path = None   # nullable on Evaluation
    db.flush()
    return release(db, [ref] if ref else [])
