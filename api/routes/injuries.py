"""Injury log endpoints: a roster player's, or a player known by name (an
opponent). The rules on who may see and change them live in api/injuries.py."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import injuries as inj
from .. import models
from ..auth import get_current_coach
from ..database import get_db

router = APIRouter(prefix="/injuries", tags=["injuries"])


class InjuryIn(BaseModel):
    player_id: int | None = None
    team_name: str | None = None
    player_name: str | None = None
    status: str | None = None
    body_part: str | None = None
    side: str | None = None
    description: str | None = None
    injured_on: date | None = None
    expected_return: date | None = None
    returned_on: date | None = None
    notes: str | None = None


def _player(db: Session, coach: models.Coach, player_id: int) -> models.Player:
    p = db.get(models.Player, player_id)
    if not p or getattr(p, "deleted_at", None) or not inj.can_manage_player(db, coach, p):
        raise HTTPException(status_code=404, detail="Player not found")
    return p


def _apply(i: models.PlayerInjury, body: InjuryIn, fields: set[str]) -> None:
    if "status" in fields:
        if body.status not in inj.STATUSES:
            raise HTTPException(status_code=400, detail="Unknown status")
        i.status = body.status
    for f in ("body_part", "side", "description", "notes"):
        if f in fields:
            v = (getattr(body, f) or "").strip()
            setattr(i, f, v[:2000] if v else None)
    for f in ("injured_on", "expected_return", "returned_on"):
        if f in fields:
            setattr(i, f, getattr(body, f))


@router.get("/players/{player_id}")
def player_injuries(player_id: int, db: Session = Depends(get_db),
                    coach: models.Coach = Depends(get_current_coach)):
    p = _player(db, coach, player_id)
    return [inj.out(i) for i in inj.for_player(db, p)]


@router.get("/named")
def named_injuries(player_name: str, team_name: str | None = None, db: Session = Depends(get_db),
                   coach: models.Coach = Depends(get_current_coach)):
    return [inj.out(i) for i in inj.for_name(db, coach, team_name, player_name)]


@router.post("")
def add_injury(body: InjuryIn, db: Session = Depends(get_db),
               coach: models.Coach = Depends(get_current_coach)):
    if body.player_id:
        p = _player(db, coach, body.player_id)
        i = models.PlayerInjury(player_id=p.id, player_name=p.name, coach_id=coach.id, source="manual")
    else:
        name = (body.player_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Which player?")
        i = models.PlayerInjury(player_name=name[:120], team_name=(body.team_name or "").strip()[:120] or None,
                                coach_id=coach.id, source="manual")
    body.status = body.status or "out"
    _apply(i, body, set(body.model_fields_set) | {"status"})
    db.add(i)
    db.commit()
    db.refresh(i)
    return inj.out(i)


@router.patch("/{injury_id}")
def edit_injury(injury_id: int, body: InjuryIn, db: Session = Depends(get_db),
                coach: models.Coach = Depends(get_current_coach)):
    i = db.get(models.PlayerInjury, injury_id)
    if not i or not inj.can_manage(db, coach, i):
        raise HTTPException(status_code=404, detail="Injury not found")
    _apply(i, body, set(body.model_fields_set) - {"player_id", "team_name", "player_name"})
    db.commit()
    db.refresh(i)
    return inj.out(i)


@router.delete("/{injury_id}")
def delete_injury(injury_id: int, db: Session = Depends(get_db),
                  coach: models.Coach = Depends(get_current_coach)):
    i = db.get(models.PlayerInjury, injury_id)
    if not i or not inj.can_manage(db, coach, i):
        raise HTTPException(status_code=404, detail="Injury not found")
    db.delete(i)
    db.commit()
    return {"ok": True}
