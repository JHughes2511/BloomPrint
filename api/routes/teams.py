from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_coach
from .. import models, schemas

router = APIRouter(prefix="/teams", tags=["teams"])

@router.post("", response_model=schemas.TeamOut)
def create_team(
    body: schemas.TeamCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    team = models.Team(name=body.name, coach_id=coach.id, competition_level=body.competition_level)
    db.add(team)
    db.commit()
    db.refresh(team)
    return team

@router.get("", response_model=list[schemas.TeamOut])
def list_teams(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    return db.query(models.Team).filter_by(coach_id=coach.id).order_by(models.Team.id).all()

@router.delete("/{team_id}")
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    team = db.get(models.Team, team_id)
    if not team or team.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Team not found")
    db.delete(team)
    db.commit()
    return {"ok": True}
