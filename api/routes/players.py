from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_coach
from .. import models, schemas

router = APIRouter(prefix="/players", tags=["players"])


@router.post("", response_model=schemas.PlayerOut)
def create_player(
    body: schemas.PlayerCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = models.Player(**body.model_dump())
    db.add(player)
    db.commit()
    db.refresh(player)
    return _with_grade(player)


@router.get("", response_model=list[schemas.PlayerOut])
def list_players(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    return [_with_grade(p) for p in db.query(models.Player).all()]


@router.get("/{player_id}", response_model=schemas.PlayerOut)
def get_player(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return _with_grade(player)


@router.get("/{player_id}/evaluations", response_model=list[schemas.EvalOut])
def player_evaluations(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return player.evaluations


def _with_grade(player: models.Player) -> schemas.PlayerOut:
    out = schemas.PlayerOut.model_validate(player)
    if player.evaluations:
        grades = [e.overall_grade for e in player.evaluations if e.overall_grade is not None]
        out.latest_grade = grades[-1] if grades else None
    return out
