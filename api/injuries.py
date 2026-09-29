"""Injuries: the log a team's staff keeps on its players, and on opponents.

Laid out the way a team's injury report is — a CURRENT injury (status, what
and where, since when, expected back) and the RECENT ones a player has come
back from. Kept here, not in a route, because every report that names a
player reads it (see player_file), and the live tracker, the roster and Scout
tag players with it.

Who sees it: the coach who owns the player's roster and the staff of the
player's team. An injury on a player known only by name (an opponent) is
seen by the coach who logged it and the coaches they share a team with.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from . import models

STATUSES = ["out", "dtd", "questionable", "playing_through", "cleared"]
STATUS_WORDS = {"out": "OUT", "dtd": "Day-to-day", "questionable": "Questionable",
                "playing_through": "Playing through it", "cleared": "Cleared"}


def is_current(i: models.PlayerInjury) -> bool:
    return i.status != "cleared" and i.returned_on is None


def out(i: models.PlayerInjury) -> dict:
    return {"id": i.id, "player_id": i.player_id, "team_name": i.team_name, "player_name": i.player_name,
            "status": i.status, "body_part": i.body_part, "side": i.side, "description": i.description,
            "injured_on": i.injured_on.isoformat() if i.injured_on else None,
            "expected_return": i.expected_return.isoformat() if i.expected_return else None,
            "returned_on": i.returned_on.isoformat() if i.returned_on else None,
            "notes": i.notes, "source": i.source, "current": is_current(i),
            "updated_at": i.updated_at.isoformat() + "Z" if i.updated_at else None}


def _norm(s: str | None) -> str:
    return " ".join((s or "").lower().split())


def team_ids_for(db: Session, coach: models.Coach) -> set[int]:
    ids = {tm.id for tm in db.query(models.Team).filter_by(coach_id=coach.id).all()}
    ids |= {l.team_id for l in db.query(models.TeamStaff).filter_by(coach_id=coach.id).all()}
    return ids


def colleague_ids(db: Session, coach: models.Coach) -> set[int]:
    """This coach and everyone they share a team with (owner or staff)."""
    teams = team_ids_for(db, coach)
    ids = {coach.id}
    if teams:
        ids |= {tm.coach_id for tm in db.query(models.Team).filter(models.Team.id.in_(teams)).all()}
        ids |= {l.coach_id for l in db.query(models.TeamStaff).filter(models.TeamStaff.team_id.in_(teams)).all()}
    return ids


def can_manage_player(db: Session, coach: models.Coach, player: models.Player) -> bool:
    """The roster's owner, or staff on the player's team."""
    if player.coach_id == coach.id:
        return True
    return player.team_id is not None and player.team_id in team_ids_for(db, coach)


def can_manage(db: Session, coach: models.Coach, i: models.PlayerInjury) -> bool:
    if i.player_id:
        p = db.get(models.Player, i.player_id)
        return bool(p) and can_manage_player(db, coach, p)
    return i.coach_id in colleague_ids(db, coach)


def for_player(db: Session, player: models.Player) -> list[models.PlayerInjury]:
    """A roster player's injuries, current first, newest first."""
    rows = db.query(models.PlayerInjury).filter_by(player_id=player.id).all()
    return _ordered(rows)


def roster_player(db: Session, coach: models.Coach, team_name: str | None,
                  player_name: str) -> models.Player | None:
    """The roster player this name is, if the coach can see one: same name, on
    a team of this name that is theirs or that they are staff on. So an injury
    logged from Scout for a team that is on the roster lands on the player."""
    teams = team_ids_for(db, coach)
    if not teams or not team_name:
        return None
    for tm in db.query(models.Team).filter(models.Team.id.in_(list(teams))).all():
        if _norm(tm.name) != _norm(team_name):
            continue
        for p in db.query(models.Player).filter_by(team_id=tm.id).all():
            if _norm(p.name) == _norm(player_name) and not getattr(p, "deleted_at", None):
                return p
    return None


def for_name(db: Session, coach: models.Coach, team_name: str | None,
             player_name: str) -> list[models.PlayerInjury]:
    """A player known by name: logged by name, or a roster player of that name
    on a team of that name that this coach can see."""
    p = roster_player(db, coach, team_name, player_name)
    if p is not None:
        return for_player(db, p)
    rows = [i for i in db.query(models.PlayerInjury)
            .filter(models.PlayerInjury.player_id.is_(None),
                    models.PlayerInjury.coach_id.in_(list(colleague_ids(db, coach)))).all()
            if _norm(i.player_name) == _norm(player_name)
            and (not team_name or _norm(i.team_name) == _norm(team_name))]
    return _ordered(rows)


def _ordered(rows: list) -> list:
    def when(i) -> date:
        return i.injured_on or (i.created_at.date() if i.created_at else date.min)
    return sorted(rows, key=lambda i: (not is_current(i), -when(i).toordinal()))


def _what(i: models.PlayerInjury) -> str:
    where = " ".join(x for x in ((i.side or "").capitalize(), i.body_part or "") if x).strip()
    return " ".join(x for x in (where, i.description or "") if x).strip() or "unspecified injury"


def line(i: models.PlayerInjury) -> str:
    """One injury as a report line: "OUT — Left Hamstring Soreness (since
    2026-03-27; expected back 2026-05-01)". Only dates that were given."""
    bits = []
    if i.injured_on:
        bits.append(f"since {i.injured_on.isoformat()}")
    if is_current(i) and i.expected_return:
        bits.append(f"expected back {i.expected_return.isoformat()}")
    if i.returned_on:
        bits.append(f"returned {i.returned_on.isoformat()}")
    head = STATUS_WORDS.get(i.status, i.status) if is_current(i) else "Recovered"
    note = f" Note: {i.notes.strip()}" if (i.notes or "").strip() else ""
    when = f" ({'; '.join(bits)})" if bits else ""
    return f"{head} — {_what(i)}{when}.{note}"


def text(rows: list[models.PlayerInjury], limit_recent: int = 4) -> str:
    """The injury section of a player's file, or empty."""
    if not rows:
        return ""
    cur = [i for i in rows if is_current(i)]
    rec = [i for i in rows if not is_current(i)][:limit_recent]
    out_ = []
    if cur:
        out_.append("  Current: " + " | ".join(line(i) for i in cur))
    if rec:
        out_.append("  Recent (returned): " + " | ".join(line(i) for i in rec))
    return "\n".join(out_)


def visible_current(db: Session, coach: models.Coach) -> list[dict]:
    """Every current injury this coach can see, for tagging players across the
    app: their own roster's and their teams' players (with the team's name),
    and players logged by name by them or a colleague."""
    teams = team_ids_for(db, coach)
    q = db.query(models.PlayerInjury, models.Player).join(models.Player, models.PlayerInjury.player_id == models.Player.id)
    from sqlalchemy import or_
    conds = [models.Player.coach_id == coach.id]
    if teams:
        conds.append(models.Player.team_id.in_(list(teams)))
    rows = [(i, p) for i, p in q.filter(or_(*conds)).all() if is_current(i) and not getattr(p, "deleted_at", None)]
    tids = {p.team_id for _, p in rows if p.team_id}
    team_names = {tm.id: tm.name for tm in db.query(models.Team).filter(models.Team.id.in_(list(tids))).all()} if tids else {}
    out_ = [{**out(i), "player_name": p.name, "team_name": team_names.get(p.team_id)} for i, p in rows]
    for i in (db.query(models.PlayerInjury)
              .filter(models.PlayerInjury.player_id.is_(None),
                      models.PlayerInjury.coach_id.in_(list(colleague_ids(db, coach)))).all()):
        if is_current(i):
            out_.append(out(i))
    return out_
