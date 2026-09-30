"""The living projection on a player's profile (api/projection.py)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, projection
from ..auth import get_current_coach
from ..database import get_db
from ..injuries import can_manage_player

router = APIRouter(prefix="/players", tags=["projection"])


def _player(db: Session, coach: models.Coach, player_id: int) -> models.Player:
    p = db.get(models.Player, player_id)
    if not p or getattr(p, "deleted_at", None) or not can_manage_player(db, coach, p):
        raise HTTPException(status_code=404, detail="Player not found")
    return p


@router.get("/{player_id}/projection")
def get_projection(player_id: int, db: Session = Depends(get_db),
                   coach: models.Coach = Depends(get_current_coach)):
    return projection.out(db, _player(db, coach, player_id))


@router.post("/{player_id}/projection/refresh")
def refresh_projection(player_id: int, db: Session = Depends(get_db),
                       coach: models.Coach = Depends(get_current_coach)):
    p = _player(db, coach, player_id)
    if not projection.has_evidence(projection.evidence(db, p)):
        raise HTTPException(status_code=400, detail="Nothing to project from yet: make a report or track a game first.")
    projection.refresh(db, p)
    return projection.out(db, p)
