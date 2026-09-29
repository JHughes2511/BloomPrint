"""A player's file: everything the app knows about one player, for a report.

Each report used to gather its own pieces of a player — an evaluation here,
tracked stats there — so what one report knew another did not. This is the
one place that gathers them, and every report that names a player reads it:

  who they are (number, position, size, team, level), the coach's notes,
  injuries (current and recent), the latest evaluation (grade, pillars,
  flags, an excerpt), tracked game stats, film tendencies, and mentions of
  them in the coach's other reports.

`player_file` is the full file, for a report ABOUT the player. `roster_lines`
is one line per player — status, injuries, notes, latest grade and flags — for
a report about a team or a game, where a full file per player would bury the
report in paper. Both only say what is on record.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from . import injuries as inj
from . import models


def _bio(p: models.Player) -> str:
    parts = [f"#{p.jersey_number}" if p.jersey_number else "", p.position or "",
             f"Height {p.height}" if p.height else "", f"Wingspan {p.wingspan}" if p.wingspan else "",
             f"Weight {p.weight}" if p.weight else "", f"Age {p.age}" if p.age else "",
             f"Level {p.competition_level}" if p.competition_level else ""]
    return " | ".join(x for x in parts if x)


def _latest_eval(p: models.Player, coach: models.Coach):
    own = [e for e in p.evaluations if e.coach_id == coach.id] or list(p.evaluations)
    own = sorted(own, key=lambda e: e.id or 0, reverse=True)
    return own


def _film_tendencies(db: Session, coach: models.Coach, team_name: str | None,
                     name: str, jersey: str | None) -> list[str]:
    if not team_name:
        return []
    try:
        from . import tendencies
        for pl in tendencies.for_opponent(db, coach.id, team_name):
            if (jersey and str(pl.get("jersey")) == str(jersey)) or \
               (pl.get("name") and tendencies.norm(pl["name"]) == tendencies.norm(name)):
                return pl.get("lines") or []
    except Exception:
        return []
    return []


def _team_name(db: Session, p: models.Player) -> str | None:
    tm = db.get(models.Team, p.team_id) if p.team_id else None
    return tm.name if tm else (p.program_name or None)


def player_file(db: Session, coach: models.Coach, p: models.Player, *,
                mentions: bool = True, stats: bool = True) -> str:
    """The full file on one roster player."""
    from .routes.game_eval import player_tracked_stats_block
    team = _team_name(db, p)
    lines = [f"=== PLAYER FILE: {p.name}{f' ({team})' if team else ''} ==="]
    bio = _bio(p)
    if bio:
        lines.append(bio)
    if (p.notes or "").strip():
        lines.append(f"Coach's notes: {p.notes.strip()}")
    rows = inj.for_player(db, p)
    lines.append("INJURIES:\n" + inj.text(rows) if rows else "INJURIES: none on record.")
    evals = _latest_eval(p, coach)
    if evals:
        e = evals[0]
        if e.overall_grade is not None:
            lines.append(f"Latest BIM grade: {e.overall_grade}/10 ({e.output_type}); evaluations on file: {len(evals)}")
        try:
            pg = ", ".join(f"{k}: {v}" for k, v in (e.pillar_grades or {}).items())
            if pg:
                lines.append(f"Pillars: {pg}")
        except Exception:
            pass
        if e.green_flags:
            lines.append("Green flags: " + "; ".join(str(x) for x in e.green_flags[:4]))
        if e.watch_flags:
            lines.append("Watch flags: " + "; ".join(str(x) for x in e.watch_flags[:4]))
        if e.report_text:
            lines.append("From the latest evaluation:\n" + e.report_text[:900])
    else:
        lines.append("No evaluations on file.")
    trainings = db.query(models.TrainingSession).filter_by(coach_id=coach.id, player_id=p.id).count()
    if trainings:
        lines.append(f"Training programs on file: {trainings}")
    if stats:
        game_ids = [g.id for g in db.query(models.GameSession).filter_by(coach_id=coach.id).all()]
        block = player_tracked_stats_block(db, coach.id, p.name, game_ids) if game_ids else ""
        if block and "No tracked" not in block:
            lines.append(block.strip()[:900])
    film = _film_tendencies(db, coach, team, p.name, p.jersey_number)
    if film:
        lines.append("Film tendencies: " + "; ".join(film[:8]))
    if mentions:
        found = _mentions(db, coach, p.name)
        if found:
            lines.append("Mentioned in other reports:\n" + "\n".join(found))
    return "\n".join(lines)


def named_player_file(db: Session, coach: models.Coach, team_name: str | None, name: str) -> str:
    """A player known by name (an opponent): the roster player's full file if
    the name is one, else what is on record by name — notes, injuries, film."""
    rp = inj.roster_player(db, coach, team_name, name)
    if rp is not None:
        return player_file(db, coach, rp)
    lines = [f"=== PLAYER FILE: {name}{f' ({team_name})' if team_name else ''} ==="]
    op = None
    if team_name:
        for o in db.query(models.OpponentPlayer).filter_by(coach_id=coach.id).all():
            if inj._norm(o.player_name) == inj._norm(name) and inj._norm(o.opponent_name) == inj._norm(team_name):
                op = o
                break
    if op is not None:
        bio = " | ".join(x for x in (f"#{op.jersey_number}" if op.jersey_number else "", op.position or "") if x)
        if bio:
            lines.append(bio)
        if (op.notes or "").strip():
            lines.append(f"Coach's notes: {op.notes.strip()}")
    rows = inj.for_name(db, coach, team_name, name)
    lines.append("INJURIES:\n" + inj.text(rows) if rows else "INJURIES: none on record.")
    film = _film_tendencies(db, coach, team_name, name, op.jersey_number if op else None)
    if film:
        lines.append("Film tendencies: " + "; ".join(film[:8]))
    return "\n".join(lines)


def _mentions(db: Session, coach: models.Coach, name: str) -> list[str]:
    out: list[str] = []

    def grab(text, src):
        if text and name and name.lower() in text.lower() and len(out) < 6:
            i = text.lower().find(name.lower())
            out.append(f"[{src}] …{text[max(0, i - 120):i + 220].strip().replace(chr(10), ' ')}…")
    for gr in db.query(models.GameReport).filter_by(coach_id=coach.id).limit(30).all():
        grab(gr.report_text, "game report")
    for trp in db.query(models.TeamReport).filter_by(coach_id=coach.id).limit(30).all():
        grab(trp.report_text, "team report")
    for gs in db.query(models.GameSession).filter_by(coach_id=coach.id).limit(40).all():
        grab(getattr(gs, "ai_scouting_report", None), f"scouting vs {gs.opponent_name}")
    for sh in db.query(models.StaffSharedReport).filter_by(recipient_id=coach.id).limit(30).all():
        grab(sh.frozen_text, "shared with you")
    return out


def _line_for(db: Session, coach: models.Coach, name: str, jersey: str | None, notes: str | None,
              injuries: list, grade=None, watch=None) -> str | None:
    bits = []
    cur = [i for i in injuries if inj.is_current(i)]
    rec = [i for i in injuries if not inj.is_current(i)][:1]
    if cur:
        bits.append("INJURED: " + " | ".join(inj.line(i) for i in cur))
    elif rec:
        bits.append("recently back from: " + inj.line(rec[0]))
    if (notes or "").strip():
        bits.append(f"notes: {notes.strip()[:240]}")
    if grade is not None:
        bits.append(f"latest grade {grade}/10")
    if watch:
        bits.append("watch: " + "; ".join(str(x) for x in watch[:2]))
    if not bits:
        return None
    return f"- {f'#{jersey} ' if jersey else ''}{name}: " + " · ".join(bits)


def roster_lines(db: Session, coach: models.Coach, team_name: str | None, *,
                 players: list[models.Player] | None = None, names: list[str] | None = None,
                 with_grades: bool = False) -> str:
    """One line per player with something on record (injury, notes, grade),
    for a report about a team or a game. Roster players by row; others by name."""
    out = []
    seen = set()
    for p in players or []:
        seen.add(inj._norm(p.name))
        e = _latest_eval(p, coach)[:1]
        ln = _line_for(db, coach, p.name, p.jersey_number, p.notes, inj.for_player(db, p),
                       grade=(e[0].overall_grade if e and with_grades else None),
                       watch=(e[0].watch_flags if e and with_grades else None))
        if ln:
            out.append(ln)
    for n in names or []:
        if inj._norm(n) in seen:
            continue
        seen.add(inj._norm(n))
        rp = inj.roster_player(db, coach, team_name, n)
        if rp is not None:
            ln = _line_for(db, coach, rp.name, rp.jersey_number, rp.notes, inj.for_player(db, rp))
        else:
            op = next((o for o in db.query(models.OpponentPlayer).filter_by(coach_id=coach.id).all()
                       if inj._norm(o.player_name) == inj._norm(n)
                       and (not team_name or inj._norm(o.opponent_name) == inj._norm(team_name))), None)
            ln = _line_for(db, coach, n, op.jersey_number if op else None, op.notes if op else None,
                           inj.for_name(db, coach, team_name, n))
        if ln:
            out.append(ln)
    if not out:
        return ""
    return (f"PLAYER FILES — {team_name or 'players'} (injuries, notes and status on record; players with "
            "nothing on record are not listed):\n" + "\n".join(out))


def game_players_block(db: Session, coach: models.Coach, game: models.GameSession) -> str:
    """Both teams' players in a game, one line each where something is on
    record: who is injured, who is just back, the coach's notes."""
    from . import play_calling as pc
    names = pc.side_names(db, game)
    ours = [s.player_name for s in game.player_stats if not s.is_opponent]
    theirs = [s.player_name for s in game.player_stats if s.is_opponent]
    roster = (db.query(models.Player).filter_by(team_id=game.team_id).all() if game.team_id else [])
    theirs += [o.player_name for o in db.query(models.OpponentPlayer).filter_by(coach_id=coach.id).all()
               if inj._norm(o.opponent_name) == inj._norm(game.opponent_name)]
    parts = [roster_lines(db, coach, names["our"], players=roster, names=list(dict.fromkeys(ours))),
             roster_lines(db, coach, names["opponent"], names=list(dict.fromkeys(theirs)))]
    parts = [x for x in parts if x]
    if not parts:
        return ""
    return ("\n\n" + "\n\n".join(parts) + "\n(Use the injuries and notes: who is out or limited, who is "
            "just back, and what that changes. Never invent an injury.)")
