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
    team = models.Team(name=body.name, coach_id=coach.id, competition_level=level,
                       is_mine=body.is_mine)
    db.add(team)
    db.commit()
    db.refresh(team)
    return team

@router.get("", response_model=list[schemas.TeamOut])
def list_teams(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    # Teams from a shared game are created in this account when the share
    # lands (see ensure_teams_for_share), so they are ordinary rows here.
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
    if body.is_mine is not None:
        team.is_mine = body.is_mine
    db.commit()
    db.refresh(team)
    return team


def _staffed(db: Session, team) -> bool:
    """Whether anybody but the owner still works on this team or one beneath it.

    Sub-teams count: ownership moves as a unit everywhere else in the app (see
    _team_and_subteams in team_staff.py), so a program whose staff sit on the
    JV team is a program somebody is still using.
    """
    ids, frontier = [team.id], [team.id]
    while frontier:
        children = (db.query(models.Team)
                    .filter(models.Team.parent_team_id.in_(frontier),
                            models.Team.coach_id == team.coach_id)
                    .all())
        if not children:
            break
        ids.extend(c.id for c in children)
        frontier = [c.id for c in children]
    return bool(db.query(models.TeamStaff)
                .filter(models.TeamStaff.team_id.in_(ids),
                        models.TeamStaff.coach_id != team.coach_id)
                .first())


@router.delete("/{team_id}")
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Remove a team from YOUR account.

    A team nobody else works on is hidden, which is the same thing as removing
    it from yours because yours is the only account it was ever on.

    A team with staff is not yours to end. Deleting it used to stamp deleted_at
    on the team row, and the soft-delete listener hides that from every query in
    the app — so three assistants lost a program because its owner tidied up.
    Instead the owner lets go of it: the team keeps running for its staff with
    nobody owning it, and any of them can claim it through the path that already
    exists for a team whose owner's account is gone.
    """
    team = db.get(models.Team, team_id)
    if not team or team.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Team not found")

    if _staffed(db, team):
        # Let go of this team and every sub-team held with it, so a program is
        # not left half owned.
        released = [team]
        frontier = [team.id]
        while frontier:
            children = (db.query(models.Team)
                        .filter(models.Team.parent_team_id.in_(frontier),
                                models.Team.coach_id == coach.id)
                        .all())
            if not children:
                break
            released.extend(children)
            frontier = [c.id for c in children]
        for t in released:
            t.coach_id = None
        # Any membership row of the owner's own goes too, or the team would
        # come straight back on their list as a team they are staff on.
        (db.query(models.TeamStaff)
         .filter(models.TeamStaff.team_id.in_([t.id for t in released]),
                 models.TeamStaff.coach_id == coach.id)
         .delete(synchronize_session=False))
        db.commit()
        return {"ok": True, "released": len(released)}

    soft_delete(db, team)
    db.commit()
    return {"ok": True}
