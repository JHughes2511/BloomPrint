"""Sharing a report hands over the people it is about.

A coach who receives an evaluation of a player they do not have could read the
report and then not find the player anywhere — no profile, no history, nowhere
to put their own evaluation. So the subject comes with the report.

It is the SAME player record, not a copy: one history, and each coach still
keeps their own BIM grade because that is scoped per coach in players.py. The
recipient can drop the player from their roster; the owner's roster is never
touched either way.

WHO A REPORT IS ABOUT

  eval, training        the one player it was written for
  tracked game          everyone in the box score, both teams
  team report, packet   nobody — those records carry no player reference at all

A box score is the awkward one: our own players usually carry a player_id, but
opponents are typically just names on stat rows, with no record anywhere. To
put those on a roster there has to be a record, so one is created — matched
first on name + program so the same opponent never lands twice.
"""
from sqlalchemy.orm import Session

from . import models


def _grant(db: Session, player_id: int, coach_id: int, granted_by: int) -> None:
    if not player_id or coach_id == granted_by:
        return
    exists = db.query(models.PlayerAccess).filter_by(
        player_id=player_id, coach_id=coach_id).first()
    if exists:
        return
    db.add(models.PlayerAccess(player_id=player_id, coach_id=coach_id,
                               granted_by=granted_by, source="shared_report"))


def _find_or_create_by_name(db: Session, name: str, program: str,
                            owner_id: int, level: str | None) -> models.Player | None:
    """One record per person, matched on name within a program.

    Case- and space-insensitive, because "J. Smith " and "j. smith" are the same
    kid typed twice. Never creates a second row for a name that already exists
    under that program.
    """
    key = " ".join((name or "").split()).strip()
    if not key:
        return None
    rows = db.query(models.Player).filter(
        models.Player.coach_id == owner_id).all()
    lowered = key.lower()
    for p in rows:
        if (p.name or "").strip().lower() == lowered and \
           (p.program_name or "").strip().lower() == (program or "").strip().lower():
            return p
    p = models.Player(
        name=key,
        coach_id=owner_id,
        program_name=program or "",
        competition_level=level or "HS Varsity",
    )
    db.add(p)
    db.flush()
    return p


def players_in_report(db: Session, report_type: str, report_id: int,
                      sender: models.Coach) -> list[int]:
    """Player ids a share should carry, creating records only where a person
    exists in a box score with no record anywhere."""
    rt = (report_type or "").lower()

    if rt == "eval":
        ev = db.get(models.Evaluation, report_id)
        return [ev.player_id] if ev and ev.player_id else []

    if rt == "training":
        ts = db.get(models.TrainingSession, report_id)
        return [ts.player_id] if ts and ts.player_id else []

    if rt in ("game", "game_session"):
        g = db.get(models.GameSession, report_id)
        if not g:
            return []
        team = db.get(models.Team, g.team_id) if g.team_id else None
        ours = team.name if team else (sender.program_name or "")
        theirs = g.opponent_name or "Opponent"
        level = (team.competition_level if team else None) or sender.competition_level
        seen: dict[str, int] = {}
        for st in db.query(models.GamePlayerStat).filter_by(game_id=g.id).all():
            if st.player_id:
                seen[f"id:{st.player_id}"] = st.player_id
                continue
            program = theirs if st.is_opponent else ours
            key = f"{program.lower()}|{(st.player_name or '').strip().lower()}"
            if key in seen:
                continue
            p = _find_or_create_by_name(db, st.player_name, program, sender.id, level)
            if p:
                seen[key] = p.id
        return list(dict.fromkeys(seen.values()))

    # team_report, team_training, game packets: no player reference exists.
    return []


def grant_players_for_share(db: Session, report_type: str, report_id: int,
                            sender: models.Coach, recipient_id: int) -> int:
    """Give the recipient the people a shared report is about. Returns how many."""
    if recipient_id == sender.id:
        return 0
    ids = players_in_report(db, report_type, report_id, sender)
    for pid in ids:
        _grant(db, pid, recipient_id, sender.id)
    return len(ids)
