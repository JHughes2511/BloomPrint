"""Staff-team linking routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..auth import get_current_coach
from .. import models

router = APIRouter(prefix="/team-staff", tags=["team-staff"])


class TeamOut(BaseModel):
    id: int
    name: str
    competition_level: str | None = None
    coach_name: str | None = None
    model_config = {"from_attributes": True}


class TeamGameItem(BaseModel):
    id: int
    kind: str          # "session" | "report"
    title: str
    date: str | None = None
    report_text: str | None = None
    ai_scouting_report: str | None = None
    our_score: int | None = None
    opponent_score: int | None = None
    model_config = {"from_attributes": True}


@router.get("/search", response_model=list[TeamOut])
def search_teams(
    q: str = "",
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Search all teams by name so staff can find programs to join."""
    teams = (
        db.query(models.Team)
        .filter(models.Team.name.ilike(f"%{q}%"))
        .limit(20)
        .all()
    )
    result = []
    for t in teams:
        owner = db.get(models.Coach, t.coach_id)
        result.append(TeamOut(
            id=t.id,
            name=t.name,
            competition_level=t.competition_level,
            coach_name=owner.name if owner else None,
        ))
    return result


@router.post("/{team_id}/join")
def join_team(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Auto-join a team — no approval required."""
    team = db.get(models.Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if team.coach_id == coach.id:
        raise HTTPException(status_code=400, detail="You already own this team")

    existing = (
        db.query(models.TeamStaff)
        .filter_by(coach_id=coach.id, team_id=team_id)
        .first()
    )
    if existing:
        return {"ok": True, "already_member": True}

    link = models.TeamStaff(coach_id=coach.id, team_id=team_id)
    db.add(link)

    # Notify the team owner
    notif = models.CoachNotification(
        coach_id=team.coach_id,
        title=f"{coach.name} joined your team",
        body=f"{coach.name} ({coach.role or 'staff'}) has joined {team.name}.",
        type="team_staff_joined",
    )
    db.add(notif)
    db.commit()
    return {"ok": True}


@router.delete("/{team_id}/leave")
def leave_team(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Disconnect from a team — stops all game visibility and notifications."""
    link = (
        db.query(models.TeamStaff)
        .filter_by(coach_id=coach.id, team_id=team_id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Not a member of this team")
    db.delete(link)
    db.commit()
    return {"ok": True}


@router.get("/my-teams", response_model=list[TeamOut])
def my_teams(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Return all teams this staff member has joined (not owned)."""
    links = (
        db.query(models.TeamStaff)
        .filter_by(coach_id=coach.id)
        .all()
    )
    result = []
    for link in links:
        team = db.get(models.Team, link.team_id)
        if not team:
            continue
        owner = db.get(models.Coach, team.coach_id)
        result.append(TeamOut(
            id=team.id,
            name=team.name,
            competition_level=team.competition_level,
            coach_name=owner.name if owner else None,
        ))
    return result


@router.get("/team-games")
def team_games(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Return all game sessions + reports for a team.
    Caller must own the team or be a linked staff member.
    """
    team = db.get(models.Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Check access
    is_owner = team.coach_id == coach.id
    is_staff = (
        db.query(models.TeamStaff)
        .filter_by(coach_id=coach.id, team_id=team_id)
        .first()
    ) is not None

    if not is_owner and not is_staff:
        raise HTTPException(status_code=403, detail="Not a member of this team")

    items = []

    # Game sessions for this team
    sessions = (
        db.query(models.GameSession)
        .filter_by(team_id=team_id)
        .order_by(models.GameSession.id.desc())
        .all()
    )
    for s in sessions:
        date_str = s.date.strftime("%B %d, %Y") if s.date else None
        score_str = ""
        if s.our_score is not None and s.opponent_score is not None:
            result_word = "W" if s.our_score > s.opponent_score else ("L" if s.our_score < s.opponent_score else "T")
            score_str = f"{result_word} {s.our_score}-{s.opponent_score}"
        items.append({
            "id": s.id,
            "kind": "session",
            "title": f"vs {s.opponent_name}" + (f" ({score_str})" if score_str else ""),
            "date": date_str,
            "ai_scouting_report": s.ai_scouting_report,
            "our_score": s.our_score,
            "opponent_score": s.opponent_score,
        })

    # Game reports linked to this team (as home or away)
    reports = (
        db.query(models.GameReport)
        .filter(
            (models.GameReport.my_team_id == team_id) |
            (models.GameReport.opponent_team_id == team_id)
        )
        .order_by(models.GameReport.id.desc())
        .all()
    )
    for r in reports:
        items.append({
            "id": r.id,
            "kind": "report",
            "title": r.title or r.opponent_name or "Game Report",
            "date": r.created_at.strftime("%B %d, %Y") if r.created_at else None,
            "report_text": r.report_text,
        })

    return {"team": {"id": team.id, "name": team.name}, "items": items}
