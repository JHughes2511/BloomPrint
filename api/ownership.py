"""One place that answers "may this coach touch this record?".

Before this, each endpoint decided for itself — and most of them fetched a row
straight by id and never asked, so any authenticated coach could read, edit or
delete another coach's evaluations, reports, teams and players just by knowing
(or guessing) an id.

Sharing does not go through here. A report shared with a staff member is read
through the staff-sharing endpoints, which check the share row and honour the
sharer's regenerate toggle. This module answers the narrower question of who
*owns* a record, which is what edit and delete turn on.
"""
from fastapi import HTTPException
from sqlalchemy.orm import Session


def get_owned(db: Session, model, obj_id, coach_id: int, what: str = "Record"):
    """Return the record only if this coach owns it.

    A record owned by someone else returns 404, not 403. 403 would confirm the
    id exists and just isn't theirs, which hands out a way to enumerate other
    coaches' data; 404 is indistinguishable from a record that was never there.
    """
    if obj_id is None:
        raise HTTPException(status_code=404, detail=f"{what} not found")
    row = db.get(model, obj_id)
    if row is None or getattr(row, "coach_id", None) != coach_id:
        raise HTTPException(status_code=404, detail=f"{what} not found")
    return row


def owns(row, coach_id: int) -> bool:
    """True when the row exists and belongs to this coach. For call sites that
    need a boolean rather than an exception (filtering a list, say)."""
    return row is not None and getattr(row, "coach_id", None) == coach_id
