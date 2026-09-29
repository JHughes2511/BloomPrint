"""Short versions of reports (api/short_versions.py): read one, or make it again."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from .. import short_versions as sv
from ..auth import get_current_coach
from ..database import get_db

router = APIRouter(prefix="/short", tags=["short-versions"])


def _check(db: Session, coach: models.Coach, kind: str, ref_id: int) -> None:
    """The coach who owns the report; for a training program, also staff who
    can see the player."""
    if kind not in sv.KIND_LAYOUT:
        raise HTTPException(status_code=404, detail="Unknown report kind")
    _, owner = sv.source_text(db, kind, ref_id)
    if owner == coach.id:
        return
    if kind == "training":
        s = db.get(models.TrainingSession, ref_id)
        if s and s.player:
            from ..injuries import can_manage_player
            if can_manage_player(db, coach, s.player):
                return
    raise HTTPException(status_code=404, detail="Report not found")


@router.get("/{kind}/{ref_id}")
def get_short(kind: str, ref_id: int, db: Session = Depends(get_db),
              coach: models.Coach = Depends(get_current_coach)):
    """The short version; starts making it when missing or out of date."""
    _check(db, coach, kind, ref_id)
    return sv.out(sv.ensure(db, kind, ref_id))


@router.post("/{kind}/{ref_id}/remake")
def remake_short(kind: str, ref_id: int, db: Session = Depends(get_db),
                 coach: models.Coach = Depends(get_current_coach)):
    _check(db, coach, kind, ref_id)
    return sv.out(sv.ensure(db, kind, ref_id, force=True))
