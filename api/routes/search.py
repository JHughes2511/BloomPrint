"""One search box over everything a coach owns.

Grouped by kind rather than blended into a single ranked list: a coach typing
"Marcus" wants the player, and a coach typing "Kennedy" wants the game against
them. Keeping the groups separate lets the client show "Players / Reports /
Games" headings, which answers "why did this match?" without a relevance score
nobody can interrogate.

Scoped to the requesting coach on every table. Search is exactly the kind of
endpoint where a missing ownership filter leaks quietly — it returns other
people's rows as "results" rather than as an error, so nothing looks wrong.
Soft-deleted rows are excluded automatically by the global filter in
api/softdelete.py.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models

router = APIRouter(prefix="/search", tags=["search"])

# Enough to show a few per group without the dropdown becoming its own screen.
PER_GROUP = 6


def _like(term: str) -> str:
    # Escape the wildcards so a coach searching for "50%" doesn't match
    # everything. The escape character is declared on each .like() below.
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("")
def search(
    q: str = Query("", min_length=0),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    term = (q or "").strip()
    # One character matches most of the database and is never what someone
    # meant; it's a keystroke on the way to a real query.
    if len(term) < 2:
        return {"players": [], "reports": [], "teams": [], "games": [], "query": term}

    pattern = _like(term)

    players = (
        db.query(models.Player)
        .filter(
            models.Player.coach_id == coach.id,
            or_(
                models.Player.name.like(pattern, escape="\\"),
                models.Player.position.like(pattern, escape="\\"),
                models.Player.school_name.like(pattern, escape="\\"),
            ),
        )
        .order_by(models.Player.name)
        .limit(PER_GROUP)
        .all()
    )

    teams = (
        db.query(models.Team)
        .filter(models.Team.coach_id == coach.id, models.Team.name.like(pattern, escape="\\"))
        .order_by(models.Team.name)
        .limit(PER_GROUP)
        .all()
    )

    # Evaluations are titled inconsistently — some carry a title, some only the
    # player's name — so match the player too, which is how coaches refer to them.
    evals = (
        db.query(models.Evaluation)
        .outerjoin(models.Player, models.Evaluation.player_id == models.Player.id)
        .filter(
            models.Evaluation.coach_id == coach.id,
            or_(
                models.Evaluation.title.like(pattern, escape="\\"),
                models.Evaluation.output_type.like(pattern, escape="\\"),
                models.Player.name.like(pattern, escape="\\"),
            ),
        )
        .order_by(models.Evaluation.id.desc())
        .limit(PER_GROUP)
        .all()
    )

    games = (
        db.query(models.GameReport)
        .filter(
            models.GameReport.coach_id == coach.id,
            or_(
                models.GameReport.title.like(pattern, escape="\\"),
                models.GameReport.opponent_name.like(pattern, escape="\\"),
            ),
        )
        .order_by(models.GameReport.id.desc())
        .limit(PER_GROUP)
        .all()
    )

    def player_name(pid) -> str | None:
        if not pid:
            return None
        p = db.get(models.Player, pid)
        return p.name if p else None

    return {
        "query": term,
        "players": [
            {"id": p.id, "name": p.name, "position": p.position,
             "team_name": p.team.name if p.team else None,
             "grade": p.bim_grade if hasattr(p, "bim_grade") else None}
            for p in players
        ],
        "teams": [
            {"id": t.id, "name": t.name, "competition_level": t.competition_level}
            for t in teams
        ],
        "reports": [
            {"id": e.id, "title": e.title or player_name(e.player_id) or e.output_type,
             "output_type": e.output_type, "player_id": e.player_id,
             "player_name": player_name(e.player_id), "created_at": e.created_at}
            for e in evals
        ],
        "games": [
            {"id": g.id, "title": g.title, "opponent_name": g.opponent_name,
             "created_at": g.created_at}
            for g in games
        ],
    }
