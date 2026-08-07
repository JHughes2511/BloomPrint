"""One search box over everything a coach can see.

Grouped by kind rather than blended into a single ranked list: a coach typing
"Marcus" wants the player, and a coach typing "Kennedy" wants the game against
them. Keeping the groups separate lets the client show "Players / Training /
Packets" headings, which answers "why did this match?" without a relevance
score nobody can interrogate.

WHAT IT LOOKS AT

Everything the app makes: players, teams, evaluations, training programs, team
reports, game packets and scouting reports. This used to be four of those, so
a training program was unfindable by name and a player who arrived through a
shared report could not be found at all — both of them plainly visible one
screen away, which reads as the search box being broken rather than narrow.

Names AND text. Typing a player's name finds their reports; typing "1-3-1" or
"transition defense" finds every report that argues about it, with the matching
line quoted underneath so a hit is never a mystery.

WHAT A COACH CAN SEE

The same rule the rest of the app uses, not a looser one written here: their
own rows, rows belonging to teams they are staff of, and rows another coach has
explicitly shared with them. Search is exactly the kind of endpoint where a
missing ownership filter leaks quietly — it returns other people's rows as
"results" rather than as an error, so nothing looks wrong. Soft-deleted rows are
excluded automatically by the global filter in api/softdelete.py.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models

router = APIRouter(prefix="/search", tags=["search"])

# Enough to show a few per group without the dropdown becoming its own screen.
# The full-results screen asks for more.
PER_GROUP = 6
MAX_GROUP = 50


def _like(term: str) -> str:
    # Escape the wildcards so a coach searching for "50%" doesn't match
    # everything. The escape character is declared on each .like() below.
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _snippet(text: str | None, term: str, width: int = 80) -> str | None:
    """The line the match was found on, so a body hit explains itself.

    Without this, searching "1-3-1" returns a row titled "Bloom Bloom" and the
    coach has no idea why it is there.
    """
    if not text:
        return None
    at = text.lower().find(term.lower())
    if at < 0:
        return None
    start = max(0, at - width // 2)
    end = min(len(text), at + len(term) + width // 2)
    out = " ".join(text[start:end].split())
    return ("…" if start > 0 else "") + out + ("…" if end < len(text) else "")


def _accessible_team_ids(db: Session, coach: models.Coach) -> set[int]:
    ids = {t.id for t in db.query(models.Team).filter_by(coach_id=coach.id).all()}
    ids |= {l.team_id for l in db.query(models.TeamStaff).filter_by(coach_id=coach.id).all()}
    return ids


def _shared_ids(db: Session, coach: models.Coach, *kinds: str) -> set[int]:
    """Report ids another coach has shared with this one, by kind."""
    rows = (
        db.query(models.StaffSharedReport)
        .filter(models.StaffSharedReport.recipient_id == coach.id,
                models.StaffSharedReport.report_type.in_(kinds))
        .all()
    )
    return {r.report_id for r in rows}


def _page(query, limit: int):
    """A group's rows plus how many there are in total, for "see all N"."""
    return query.limit(limit).all(), query.count()


@router.get("")
def search(
    q: str = Query("", min_length=0),
    limit: int = Query(PER_GROUP, ge=1, le=MAX_GROUP),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    term = (q or "").strip()
    # One character matches most of the database and is never what someone
    # meant; it's a keystroke on the way to a real query.
    if len(term) < 2:
        return {"query": term, "players": [], "teams": [], "reports": [],
                "training": [], "team_reports": [], "games": [], "scouting": [],
                "totals": {}}

    pattern = _like(term)
    team_ids = _accessible_team_ids(db, coach)
    granted = {a.player_id for a in db.query(models.PlayerAccess).filter_by(coach_id=coach.id).all()}

    # ── Who this coach can see ────────────────────────────────────────────────
    player_scope = [models.Player.coach_id == coach.id]
    if team_ids:
        player_scope.append(models.Player.team_id.in_(team_ids))
    if granted:
        # Shared with me: the report about them came with the person.
        player_scope.append(models.Player.id.in_(granted))

    players_q = (
        db.query(models.Player)
        .filter(or_(*player_scope))
        .filter(or_(
            models.Player.name.like(pattern, escape="\\"),
            models.Player.position.like(pattern, escape="\\"),
            models.Player.school_name.like(pattern, escape="\\"),
            models.Player.program_name.like(pattern, escape="\\"),
        ))
        .order_by(models.Player.name)
    )
    players, players_n = _page(players_q, limit)

    teams_q = (
        db.query(models.Team)
        .filter(or_(models.Team.coach_id == coach.id,
                    models.Team.id.in_(team_ids) if team_ids else models.Team.id.is_(None)))
        .filter(or_(models.Team.name.like(pattern, escape="\\"),
                    models.Team.competition_level.like(pattern, escape="\\")))
        .order_by(models.Team.name)
    )
    teams, teams_n = _page(teams_q, limit)

    # ── Reports ───────────────────────────────────────────────────────────────
    # Evaluations are titled inconsistently — some carry a title, some only the
    # player's name — so match the player too, which is how coaches refer to
    # them, and the body, which is what they actually remember about one.
    shared_evals = _shared_ids(db, coach, "eval")
    evals_q = (
        db.query(models.Evaluation)
        .outerjoin(models.Player, models.Evaluation.player_id == models.Player.id)
        .filter(or_(models.Evaluation.coach_id == coach.id,
                    models.Evaluation.id.in_(shared_evals) if shared_evals
                    else models.Evaluation.id.is_(None)))
        .filter(or_(
            models.Evaluation.title.like(pattern, escape="\\"),
            models.Evaluation.output_type.like(pattern, escape="\\"),
            models.Evaluation.report_text.like(pattern, escape="\\"),
            models.Player.name.like(pattern, escape="\\"),
        ))
        .order_by(models.Evaluation.id.desc())
    )
    evals, evals_n = _page(evals_q, limit)

    shared_training = _shared_ids(db, coach, "training")
    training_q = (
        db.query(models.TrainingSession)
        .outerjoin(models.Player, models.TrainingSession.player_id == models.Player.id)
        .filter(or_(models.TrainingSession.coach_id == coach.id,
                    models.TrainingSession.id.in_(shared_training) if shared_training
                    else models.TrainingSession.id.is_(None)))
        .filter(or_(
            models.TrainingSession.title.like(pattern, escape="\\"),
            models.TrainingSession.program_text.like(pattern, escape="\\"),
            models.Player.name.like(pattern, escape="\\"),
        ))
        .order_by(models.TrainingSession.id.desc())
    )
    training, training_n = _page(training_q, limit)

    shared_team_reports = _shared_ids(db, coach, "team_report", "team_training")
    team_reports_q = (
        db.query(models.TeamReport)
        .filter(or_(models.TeamReport.coach_id == coach.id,
                    models.TeamReport.id.in_(shared_team_reports) if shared_team_reports
                    else models.TeamReport.id.is_(None)))
        .filter(or_(
            models.TeamReport.output_type.like(pattern, escape="\\"),
            models.TeamReport.focus_prompt.like(pattern, escape="\\"),
            models.TeamReport.report_text.like(pattern, escape="\\"),
        ))
        .order_by(models.TeamReport.id.desc())
    )
    team_reports, team_reports_n = _page(team_reports_q, limit)

    shared_packets = _shared_ids(db, coach, "game")
    games_q = (
        db.query(models.GameReport)
        .filter(or_(models.GameReport.coach_id == coach.id,
                    models.GameReport.id.in_(shared_packets) if shared_packets
                    else models.GameReport.id.is_(None)))
        .filter(or_(
            models.GameReport.title.like(pattern, escape="\\"),
            models.GameReport.opponent_name.like(pattern, escape="\\"),
            models.GameReport.opponent_a_name.like(pattern, escape="\\"),
            models.GameReport.focus_prompt.like(pattern, escape="\\"),
            models.GameReport.scouting_notes.like(pattern, escape="\\"),
            models.GameReport.box_score.like(pattern, escape="\\"),
            models.GameReport.report_text.like(pattern, escape="\\"),
        ))
        .order_by(models.GameReport.id.desc())
    )
    games, games_n = _page(games_q, limit)

    # Tracked games and the scouting reports written off them. The report is
    # per-coach, so a match on someone else's report must not surface here —
    # only this coach's own, alongside the game's own legacy report.
    mine_scouted = {
        r.game_id for r in db.query(models.GameScoutingReport)
        .filter(models.GameScoutingReport.coach_id == coach.id,
                models.GameScoutingReport.report_text.like(pattern, escape="\\"))
        .all()
    }
    scouting_q = (
        db.query(models.GameSession)
        .filter(or_(models.GameSession.coach_id == coach.id,
                    models.GameSession.team_id.in_(team_ids) if team_ids
                    else models.GameSession.id.is_(None)))
        .filter(or_(
            models.GameSession.opponent_name.like(pattern, escape="\\"),
            models.GameSession.location.like(pattern, escape="\\"),
            models.GameSession.ai_scouting_report.like(pattern, escape="\\"),
            models.GameSession.id.in_(mine_scouted) if mine_scouted
            else models.GameSession.id.is_(None),
        ))
        .order_by(models.GameSession.id.desc())
    )
    scouting, scouting_n = _page(scouting_q, limit)

    def player_name(pid) -> str | None:
        if not pid:
            return None
        p = db.get(models.Player, pid)
        return p.name if p else None

    def my_scout_text(game_id: int) -> str | None:
        row = (db.query(models.GameScoutingReport)
               .filter_by(game_id=game_id, coach_id=coach.id).first())
        return row.report_text if row else None

    return {
        "query": term,
        "players": [
            {"id": p.id, "name": p.name, "position": p.position,
             "team_name": p.team.name if p.team else None,
             "mine": p.coach_id == coach.id}
            for p in players
        ],
        "teams": [
            {"id": t.id, "name": t.name, "competition_level": t.competition_level}
            for t in teams
        ],
        "reports": [
            {"id": e.id, "title": e.title or player_name(e.player_id) or e.output_type,
             "output_type": e.output_type, "player_id": e.player_id,
             "player_name": player_name(e.player_id),
             "snippet": _snippet(e.report_text, term), "created_at": e.created_at}
            for e in evals
        ],
        "training": [
            {"id": ts.id, "title": ts.title or player_name(ts.player_id) or "Training Program",
             "player_id": ts.player_id, "player_name": player_name(ts.player_id),
             "snippet": _snippet(ts.program_text, term), "created_at": ts.created_at}
            for ts in training
        ],
        "team_reports": [
            {"id": tr.id, "title": tr.output_type, "output_type": tr.output_type,
             "snippet": _snippet(tr.report_text, term) or _snippet(tr.focus_prompt, term),
             "created_at": tr.created_at}
            for tr in team_reports
        ],
        "games": [
            {"id": g.id, "title": g.title, "opponent_name": g.opponent_name,
             "output_type": g.output_type,
             "snippet": (_snippet(g.report_text, term) or _snippet(g.scouting_notes, term)
                         or _snippet(g.box_score, term)),
             "created_at": g.created_at}
            for g in games
        ],
        "scouting": [
            {"id": s.id, "opponent_name": s.opponent_name, "location": s.location,
             "date": s.date,
             "snippet": (_snippet(my_scout_text(s.id), term)
                         or _snippet(s.ai_scouting_report, term)),
             "created_at": s.created_at}
            for s in scouting
        ],
        # What the client needs to offer "see all 23" rather than silently
        # showing six of them and looking like that is all there is.
        "totals": {
            "players": players_n, "teams": teams_n, "reports": evals_n,
            "training": training_n, "team_reports": team_reports_n,
            "games": games_n, "scouting": scouting_n,
        },
    }
