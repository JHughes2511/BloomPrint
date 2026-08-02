from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_coach
from .. import models, schemas
from ..softdelete import soft_delete

router = APIRouter(prefix="/teams", tags=["teams"])

@router.post("", response_model=schemas.TeamOut)
def create_team(
    body: schemas.TeamCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    # A coach who told us their level at signup should not have to say it again
    # for every team they create. Staff Hub's Create a team asks for a name and
    # nothing else, and was landing every one of them on the schema's old
    # hard-coded HS Varsity.
    level = body.competition_level or coach.competition_level or "HS Varsity"
    team = models.Team(name=body.name, coach_id=coach.id, competition_level=level)
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

@router.patch("/{team_id}", response_model=schemas.TeamOut)
def update_team(
    team_id: int,
    body: schemas.TeamUpdate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    team = db.get(models.Team, team_id)
    if not team or team.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Team not found")
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Team name can't be empty")
        # Keep each player's stored program_name in sync with the team name.
        old_name = team.name
        team.name = name
        for p in db.query(models.Player).filter_by(team_id=team.id).all():
            if p.program_name == old_name:
                p.program_name = name
    if body.competition_level is not None:
        team.competition_level = body.competition_level
    db.commit()
    db.refresh(team)
    return team


@router.delete("/{team_id}")
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    team = db.get(models.Team, team_id)
    if not team or team.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Team not found")
    soft_delete(db, team)
    db.commit()
    return {"ok": True}
