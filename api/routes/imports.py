"""Unified AI-powered imports: every "Import" button posts any file here, the
model extracts structured rows, the app shows a preview, and a separate commit
endpoint writes the confirmed data. Deterministic writes stay server-side; only
the messy file → rows step is AI."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models
from .. import ai_import
from ..uploadguard import read_upload

router = APIRouter(prefix="/imports", tags=["imports"])


# ── Roster ────────────────────────────────────────────────────────────────────

@router.post("/roster/preview")
async def roster_preview(
    file: UploadFile = File(...),
    coach: models.Coach = Depends(get_current_coach),
):
    """Extract a roster from any file → a list of players for the coach to
    confirm. Nothing is saved yet."""
    data = await read_upload(file, what='file')
    try:
        parsed = ai_import.ai_extract_json(data, file.filename or "", file.content_type, ai_import.ROSTER_INSTRUCTION)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    players = (parsed or {}).get("players") if isinstance(parsed, dict) else parsed
    if not isinstance(players, list) or not players:
        raise HTTPException(status_code=422, detail="Couldn't find any players in that file. Try a clearer roster.")
    clean = []
    for p in players:
        if not isinstance(p, dict):
            continue
        name = str(p.get("name") or "").strip()
        if not name:
            continue
        clean.append({
            "name": name,
            "jersey_number": str(p.get("jersey_number") or "").strip(),
            "position": str(p.get("position") or "").strip(),
            "height": str(p.get("height") or "").strip(),
            "wingspan": str(p.get("wingspan") or "").strip(),
            "weight": str(p.get("weight") or "").strip(),
            "school_name": str(p.get("school_name") or "").strip(),
            "competition_level": str(p.get("competition_level") or "").strip(),
        })
    if not clean:
        raise HTTPException(status_code=422, detail="Couldn't find any named players in that file.")
    return {"players": clean}


class RosterCommit(BaseModel):
    team_id: int | None = None
    competition_level: str = "HS Varsity"
    players: list[dict]


@router.post("/roster/commit")
def roster_commit(
    body: RosterCommit,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Create the confirmed players on the given team (find-or-create by name)."""
    from ..coach_context import resolve_level
    program_name = coach.program_name
    team = None
    if body.team_id:
        team = db.get(models.Team, body.team_id)
        if not team or team.coach_id != coach.id:
            raise HTTPException(status_code=404, detail="Team not found")
        program_name = team.name
    default_level = resolve_level(coach, team=team)
    created = updated = 0
    for p in body.players:
        name = str(p.get("name") or "").strip()
        if not name:
            continue
        existing = (
            db.query(models.Player)
            .filter(models.Player.coach_id == coach.id, models.Player.name.ilike(name))
            .first()
        )
        fields = dict(
            position=p.get("position") or None,
            jersey_number=p.get("jersey_number") or None,
            height=p.get("height") or None,
            wingspan=p.get("wingspan") or None,
            weight=p.get("weight") or None,
            school_name=p.get("school_name") or None,
            competition_level=p.get("competition_level") or default_level,
        )
        if existing:
            for k, v in fields.items():
                if v and not getattr(existing, k, None):
                    setattr(existing, k, v)
            if body.team_id:
                existing.team_id = body.team_id
                existing.program_name = program_name
            updated += 1
        else:
            db.add(models.Player(
                name=name, coach_id=coach.id, team_id=body.team_id,
                program_name=program_name, **fields,
            ))
            created += 1
    db.commit()
    return {"created": created, "updated": updated}


# ── Game box-score stats ──────────────────────────────────────────────────────

@router.post("/game-stats/preview")
async def game_stats_preview(
    files: list[UploadFile] = File(...),
    game_id: int | None = Form(None),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Read a box score out of any number of files, of any type.

    One file at a time was the wrong shape for a real game: the numbers arrive
    as a stat sheet plus a shooting breakdown, or two photos of one page, or a
    PDF for us and a screenshot for them. Every file is read and the players
    merged, so what comes back is the game rather than one document of it.
    """
    players: list = []
    events: list = []
    shots: list = []
    team_stats: list = []
    errors: list[str] = []
    for f in files:
        data = await read_upload(f, what='file')
        try:
            parsed = ai_import.ai_extract_json(data, f.filename or "", f.content_type,
                                               ai_import.GAME_FILE_INSTRUCTION)
        except RuntimeError as e:
            errors.append(f"{f.filename}: {e}")
            continue
        if not isinstance(parsed, dict):
            # An older shape: a bare list of players.
            if isinstance(parsed, list):
                players.extend(parsed)
            continue
        # One read per file, taking whatever it turned out to hold — a box score,
        # a play-by-play, shot locations, a team-totals panel, or several at once.
        for key, sink in (("players", players), ("events", events),
                          ("shots", shots), ("team_stats", team_stats)):
            got = parsed.get(key)
            if isinstance(got, list):
                sink.extend(got)
    if not (players or events or shots or team_stats):
        raise HTTPException(
            status_code=422,
            detail="Couldn't read anything usable from " +
                   ("those files." if len(files) > 1 else "that file.") +
                   (" " + "; ".join(errors) if errors else ""))
    from .game_eval import _IMPORT_STAT_POINTS
    valid = set(_IMPORT_STAT_POINTS.keys())
    clean = []
    for p in players:
        if not isinstance(p, dict):
            continue
        name = str(p.get("player_name") or p.get("name") or "").strip()
        if not name:
            continue
        stats = p.get("stats") if isinstance(p.get("stats"), dict) else {}
        norm = {}
        for k, v in stats.items():
            if k in valid:
                try:
                    n = int(float(v))
                except (TypeError, ValueError):
                    continue
                if n > 0:
                    norm[k] = n
        clean.append({"player_name": name, "team_name": str(p.get("team_name") or "").strip(),
                      "jersey_number": str(p.get("jersey_number") or "").strip() or None,
                      "is_opponent": bool(p.get("is_opponent")), "stats": norm})

    # The game knows who is playing; the file knows what it called them. Matching
    # the two is far better than the model's guess at which side is "the
    # opponent" — a sheet says "Angola" and "Egypt", not "us" and "them", so
    # without this every team on it defaulted to our side, both teams' players
    # landed under one, and the game had no opponent score to work a result out
    # from. The coach can still change it; this is only what it opens on.
    # Labels the file used that are NOT either team in this game. A stat chart
    # with two coloured columns and no names is not a thing to guess at: the
    # guess reads exactly like knowledge once it is drawn as a bar, and it put a
    # whole team's totals on the other side. These come back with the preview so
    # the coach can say which is which — and only these, because a sheet headed
    # "Angola" and "Egypt" needs no question asked.
    unresolved: dict[str, dict] = {}
    if game_id is not None:
        from .game_eval import _side_for
        game = db.get(models.GameSession, game_id)
        if game is not None:
            team_row = db.get(models.Team, game.team_id) if game.team_id else None
            ours = (team_row.name if team_row else None) or coach.program_name or ""
            theirs = game.opponent_name or ""

            def note(label: str, section: str) -> None:
                if _side_for(label, ours, theirs) is not None:
                    return
                at = unresolved.setdefault(
                    str(label or "").strip() or "(no heading)",
                    {"label": str(label or "").strip() or "(no heading)", "sections": {}})
                at["sections"][section] = at["sections"].get(section, 0) + 1

            for row in clean:
                side = _side_for(row["team_name"], ours, theirs)
                if side is not None:
                    row["is_opponent"] = side
                else:
                    note(row["team_name"], "players")
            for section, rows in (("events", events), ("shots", shots),
                                  ("team_stats", team_stats)):
                for r in rows:
                    if isinstance(r, dict):
                        note(r.get("team_name"), section)

    # The same player read from two files is one player. Merged by taking the
    # larger count per stat rather than adding: two photos of the same sheet are
    # the same numbers twice, and summing them would double the game.
    merged: dict[tuple[str, str], dict] = {}
    for row in clean:
        # Keyed by team as well as name, so two rosters with a Chris on each stay
        # two players — and NOT by is_opponent, which is the model's guess and
        # the very thing the coach is about to correct.
        key = (row["player_name"].lower(), row["team_name"].lower())
        if key not in merged:
            merged[key] = row
            continue
        into = merged[key]["stats"]
        for k, v in row["stats"].items():
            into[k] = max(into.get(k, 0), v)
        # A number printed on one of the two files is a number for this player.
        if row.get("jersey_number") and not merged[key].get("jersey_number"):
            merged[key]["jersey_number"] = row["jersey_number"]
    # Events, shots and team totals are not reviewed row by row — a coach is not
    # going to tick four hundred play-by-play lines — so they travel with the
    # preview and are counted for them instead.
    return {
        "players": list(merged.values()),
        "events": events, "shots": shots, "team_stats": team_stats,
        "found": {"players": len(merged), "events": len(events),
                  "shots": len(shots), "team_stats": len(team_stats)},
        "unresolved": sorted(unresolved.values(), key=lambda u: u["label"]),
        "errors": errors,
    }


_ADVANCED_KEYS = ("points_off_turnovers", "fast_break_points", "second_chance_points",
                  "points_in_paint", "bench_points")
_PANEL_KEYS = ("PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK", "TO", "PF") + _ADVANCED_KEYS


class GameStatsCommit(BaseModel):
    """One import's worth of a game.

    A section that arrives with rows REPLACES what was there; a section that
    arrives empty is left exactly as it is. That is what lets a coach keep
    adding to a post-game — the stat sheet today, the play-by-play tomorrow,
    one panel re-read because the model misread it — without each import
    wiping the ones before it. Nothing here can delete a section; that is the
    coach's job, by hand.
    """
    game_id: int
    players: list[dict] = []
    # Everything else the files held, passed back untouched from the preview.
    events: list[dict] = []
    shots: list[dict] = []
    team_stats: list[dict] = []
    # {"red, left": true} — the coach's answer for a label the file used that is
    # not either team's name. Beats every other way of deciding a side.
    label_sides: dict[str, bool] = {}


@router.post("/game-stats/commit")
def game_stats_commit(
    body: GameStatsCommit,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    from .game_eval import (
        _get_game, _import_raw, stat_category, _clear_prior_import,
        IMPORT_QUARTER, IMPORT_MULTIPLIER,
    )
    game = _get_game(db, body.game_id, coach.id)
    # Whole-game totals: neutral quarter, no clutch multiplier. See game_eval.
    q, mult = IMPORT_QUARTER, IMPORT_MULTIPLIER
    imported = 0
    # Clear only the sides this file actually covers.
    #
    # Clearing the whole game meant the second file replaced the first: import
    # our stat sheet, then theirs, and ours was gone. Clearing nothing would be
    # worse in the other direction — re-importing a corrected sheet could only
    # ever raise a number, never lower one, and a player struck off the sheet
    # would live on forever.
    #
    # So a file is authoritative for the teams it names and silent about the
    # rest: the newest sheet for a side wins outright, and a side the file does
    # not mention is not touched. A commit carrying no players at all (a re-read
    # of one panel) clears nothing.
    for side in {bool(p.get("is_opponent")) for p in body.players}:
        _clear_prior_import(db, game.id, is_opponent=side)
    for p in body.players:
        name = str(p.get("player_name") or "").strip()
        if not name:
            continue
        is_opp = bool(p.get("is_opponent"))
        jersey = str(p.get("jersey_number") or "").strip() or None
        stats = p.get("stats") if isinstance(p.get("stats"), dict) else {}
        for stat, count in stats.items():
            try:
                count = int(count)
            except (TypeError, ValueError):
                continue
            if count <= 0:
                continue
            raw = _import_raw(stat, count)
            db.add(models.GamePlayerStat(
                game_id=game.id, player_name=name, is_opponent=is_opp,
                jersey_number=jersey,
                quarter=q, stat_name=stat, stat_category=stat_category(stat),
                raw_points=raw, quarter_multiplier=mult, weighted_points=raw * mult, count=count,
                source="import",
            ))
            imported += 1

    # The side each team name landed on, decided by the coach in the preview.
    # Events and shots carry a team name, not a side, so this is how they are
    # placed — the same answer, applied to every row from that team.
    side_of: dict[str, bool] = {}
    for p in body.players:
        tn = str(p.get("team_name") or "").strip().lower()
        if tn:
            side_of[tn] = bool(p.get("is_opponent"))

    # Events, shots and team totals name a team; the game knows who is playing.
    # Looking the name up ONLY among the players' teams put anything the players
    # did not mention on our side by default — which is how the opponent's
    # team-totals panel ended up filed under our team and theirs came out empty.
    from .game_eval import _side_for
    team_row = db.get(models.Team, game.team_id) if game.team_id else None
    ours_name = (team_row.name if team_row else None) or coach.program_name or ""

    answered = {str(k or "").strip().lower(): bool(v) for k, v in (body.label_sides or {}).items()}

    def side_for(team_name) -> bool:
        key = str(team_name or "").strip().lower()
        # The coach was asked outright, so their answer outranks both the name
        # match and the players' own sides.
        if key in answered:
            return answered[key]
        if key in side_of:
            return side_of[key]
        matched = _side_for(str(team_name or ""), ours_name, game.opponent_name or "")
        return bool(matched) if matched is not None else False

    def clock_seconds(raw) -> float | None:
        """A game clock as printed — "8:32", "0:04.5", or already a number."""
        if raw is None:
            return None
        if isinstance(raw, (int, float)):
            return float(raw)
        text = str(raw).strip()
        if not text:
            return None
        try:
            if ":" in text:
                mins, _, secs = text.partition(":")
                return int(mins) * 60 + float(secs)
            return float(text)
        except ValueError:
            return None

    events_in = shots_in = advanced_in = 0
    if body.events:
        # By period, not by side. A play-by-play is one running account of both
        # teams, so splicing half of a new one into half of an old one would
        # give the lead tracker a scoreline that never happened — but a coach
        # who has the first half today and the second half tomorrow should end
        # up with a whole game, not the second half.
        periods = {_as_int(e.get("period")) for e in body.events if isinstance(e, dict)}
        q = db.query(models.GamePlayEvent).filter_by(game_id=game.id)
        if None not in periods:
            # An unlabelled event cannot be placed, so a file with any of them
            # is taken as the whole account.
            q = q.filter(models.GamePlayEvent.period.in_(periods))
        q.delete(synchronize_session=False)
        for i, e in enumerate(body.events):
            if not isinstance(e, dict):
                continue
            opp = side_for(e.get("team_name"))
            # home/away as the file labelled them is not ours/theirs; the score
            # is stored on our terms so nothing downstream has to guess.
            hs, as_ = e.get("home_score"), e.get("away_score")
            ours = as_ if opp else hs
            theirs = hs if opp else as_
            db.add(models.GamePlayEvent(
                game_id=game.id, sequence=i,
                period=_as_int(e.get("period")),
                clock_seconds=clock_seconds(e.get("clock")),
                is_opponent=opp,
                player_name=str(e.get("player_name") or "").strip() or None,
                description=str(e.get("description") or "").strip() or None,
                points=_as_int(e.get("points")) or 0,
                our_score=_as_int(ours), opponent_score=_as_int(theirs),
            ))
            events_in += 1
    if body.shots:
        # Per side, like the box score: a shot chart is usually one team's.
        for side in {side_for(sh.get("team_name")) for sh in body.shots
                     if isinstance(sh, dict)}:
            db.query(models.GameShot).filter_by(game_id=game.id, is_opponent=side).delete()
        for sh in body.shots:
            if not isinstance(sh, dict):
                continue
            x, y = sh.get("x"), sh.get("y")
            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                continue
            db.add(models.GameShot(
                game_id=game.id, is_opponent=side_for(sh.get("team_name")),
                player_name=str(sh.get("player_name") or "").strip() or None,
                period=_as_int(sh.get("period")),
                x=float(x), y=float(y), made=bool(sh.get("made")),
                points=_as_int(sh.get("points")),
            ))
            shots_in += 1
    if body.team_stats:
        # A row that states nothing is not a totals panel. Keeping them drew two
        # named teams with no bars under them, which looks like a game where
        # neither side did anything rather than a read that came back empty.
        body.team_stats = [ts for ts in body.team_stats if isinstance(ts, dict)
                           and any(_as_int(ts.get(k)) is not None for k in _PANEL_KEYS)]
    if body.team_stats:
        # The totals panel is printed per team, so it replaces per team.
        for side in {side_for(ts.get("team_name")) for ts in body.team_stats
                     if isinstance(ts, dict)}:
            db.query(models.GameTeamAdvanced).filter_by(game_id=game.id, is_opponent=side).delete()
        for ts in body.team_stats:
            if not isinstance(ts, dict):
                continue
            db.add(models.GameTeamAdvanced(
                game_id=game.id, is_opponent=side_for(ts.get("team_name")),
                pts=_as_int(ts.get("PTS")), reb=_as_int(ts.get("REB")),
                oreb=_as_int(ts.get("OREB")), dreb=_as_int(ts.get("DREB")),
                ast=_as_int(ts.get("AST")), stl=_as_int(ts.get("STL")),
                blk=_as_int(ts.get("BLK")), tov=_as_int(ts.get("TO")),
                pf=_as_int(ts.get("PF")),
                points_off_turnovers=_as_int(ts.get("points_off_turnovers")),
                fast_break_points=_as_int(ts.get("fast_break_points")),
                second_chance_points=_as_int(ts.get("second_chance_points")),
                points_in_paint=_as_int(ts.get("points_in_paint")),
                bench_points=_as_int(ts.get("bench_points")),
            ))
            advanced_in += 1

    try:
        db.commit()
    except Exception as exc:
        # A schema that is behind the code fails here and nowhere else, and the
        # generic 500 that followed told the coach nothing they could act on or
        # repeat back. The reason travels.
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save the imported stats: {exc}")

    roster = _sync_roster(db, game, coach, body.players)
    return {"imported": imported, "events": events_in, "shots": shots_in,
            "team_stats": advanced_in, "roster": roster}


def _norm_name(x) -> str:
    return "".join(ch for ch in str(x or "").lower() if ch.isalnum())


def _sync_roster(db: Session, game, coach, players: list[dict]) -> dict:
    """Put what the sheet said about the players onto the teams themselves.

    A box score is often the only place a squad number is ever written down,
    and it was being read and dropped — the coach then typed the same numbers
    into Roster by hand off the same sheet. Anyone the sheet names who is not
    on the team is added, and anyone already there has their number brought up
    to what the sheet printed.

    Our side goes to the game's team. The opponent's side goes to the opponent's
    team — created here if the coach never built one, because at that point the
    app is holding a full squad list with numbers and refusing to keep it.
    """
    ours_id = game.team_id
    opp_row = None
    created_team: str | None = None
    if game.opponent_name and any(p.get("is_opponent") for p in players):
        opp_row = next(
            (tm for tm in db.query(models.Team).filter_by(coach_id=coach.id).all()
             if _norm_name(tm.name) == _norm_name(game.opponent_name) and tm.id != ours_id),
            None)
        if opp_row is None:
            opp_row = models.Team(name=game.opponent_name.strip(), coach_id=coach.id)
            db.add(opp_row)
            db.flush()      # an id, so the players below can point at it
            created_team = opp_row.name
    added = numbered = 0
    for side_is_opp, team_id in ((False, ours_id), (True, opp_row.id if opp_row else None)):
        if not team_id:
            continue
        existing = db.query(models.Player).filter_by(team_id=team_id).all()
        by_name = {_norm_name(p.name): p for p in existing}
        for p in players:
            if bool(p.get("is_opponent")) != side_is_opp:
                continue
            name = str(p.get("player_name") or "").strip()
            if not name:
                continue
            jersey = str(p.get("jersey_number") or "").strip() or None
            at = by_name.get(_norm_name(name))
            if at is None:
                at = models.Player(name=name, team_id=team_id, coach_id=coach.id,
                                   jersey_number=jersey)
                db.add(at)
                by_name[_norm_name(name)] = at
                added += 1
                numbered += 1 if jersey else 0
            elif jersey and at.jersey_number != jersey:
                # The sheet is the most recent statement of who wore what.
                at.jersey_number = jersey
                numbered += 1
    if added or numbered or created_team:
        try:
            db.commit()
        except Exception:
            # The game is saved and that is what was asked for. A roster that
            # did not take can be fixed on the Roster page; failing the import
            # over it would throw away the numbers as well.
            db.rollback()
            return {"added": 0, "numbered": 0, "created_team": None}
    return {"added": added, "numbered": numbered, "created_team": created_team}


def _as_int(v) -> int | None:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


# ── Free-text extraction (notes, focus, box-score text, scouting notes) ───────

@router.post("/text")
async def import_text(
    file: UploadFile = File(...),
    purpose: str = "coaching notes",
    coach: models.Coach = Depends(get_current_coach),
):
    """Return clean extracted text from any file (for Notes / Focus / Box Score /
    Scouting Notes fields). Images and PDFs are transcribed by the model."""
    data = await read_upload(file, what='file')
    try:
        text = ai_import.ai_extract_text(data, file.filename or "", file.content_type, purpose)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not text:
        raise HTTPException(status_code=422, detail="No readable text was found in that file.")
    return {"text": text}


# ── Re-reading one section, with the coach saying what was wrong ─────────────

SECTIONS = {
    "players": "the per-player box score",
    "team_stats": "the team totals panel (including points off turnovers, fast break, "
                  "second chance, points in the paint and bench points)",
    "events": "the play-by-play",
    "shots": "the shot locations",
    # Advanced Stats is fed by team_stats but is only about five of its fields,
    # and asking for the whole panel got the whole panel read loosely — the five
    # came back missing from a file that plainly showed them. Naming exactly what
    # is wanted, and the shape it is usually drawn in, is the difference.
    "advanced": "the five possession stats: points off turnovers, fast-break points, "
                "second-chance points, points in the paint, and bench points",
}

# Which key in the returned JSON each section is read out of.
SECTION_OUTPUT = {**{k: k for k in ("players", "team_stats", "events", "shots")},
                  "advanced": "team_stats"}

SECTION_FOCUS = {
    "advanced": (
        "\nTHESE FIVE NUMBERS ARE THE ENTIRE POINT OF THIS PASS. Put them in "
        "team_stats as points_off_turnovers, fast_break_points, "
        "second_chance_points, points_in_paint and bench_points, one row per team.\n"
        "They are very often drawn as a comparison chart rather than printed in a "
        "table: the stat's name down the middle — 'Points off Turnovers', 'Fast "
        "Break Points', 'Second Chance Points', 'Points in the Paint', 'Points from "
        "the Bench' — with one team's number and bar to the LEFT of the label and "
        "the other team's to the RIGHT. Read BOTH ends of every row. A small "
        "triangle or arrow beside a number only marks which side is higher; it is "
        "not part of the number.\n"
        "Give PTS, REB and the rest too if the file shows them, but never at the "
        "cost of these five.\n"
    ),
}


@router.post("/game-stats/resection")
async def regenerate_section(
    files: list[UploadFile] = File(...),
    game_id: int = Form(...),
    section: str = Form(...),
    note: str = Form(""),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Read one section again, guided by what the coach says went wrong.

    A reader misses things — a 7 read as an 8, a team's panel filed under the
    other side — and until now the only recourse was to import everything again
    and hope it landed differently. This re-reads the file for ONE section, with
    the coach's correction in the prompt, and replaces only that section. What
    was right, and anything edited by hand, is left alone.
    """
    from .game_eval import _get_game, _side_for
    if section not in SECTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown section: {section}")
    game = _get_game(db, game_id, coach.id)
    team_row = db.get(models.Team, game.team_id) if game.team_id else None
    ours_name = (team_row.name if team_row else None) or coach.program_name or ""

    out_key = SECTION_OUTPUT[section]
    instruction = (
        ai_import.GAME_FILE_INSTRUCTION
        + f"\n\nTHIS PASS IS ONLY ABOUT {SECTIONS[section].upper()}. Return that section "
        "and omit the others.\n"
        + SECTION_FOCUS.get(section, "")
        + f"The two teams in this game are {ours_name!r} and {game.opponent_name!r}; use "
        "those names for team_name where the file's headings match them.\n"
    )
    if note.strip():
        instruction += (
            "\nTHE COACH HAS READ YOUR PREVIOUS ATTEMPT AND SAYS THIS WAS WRONG:\n"
            f"{note.strip()}\n"
            "They were looking at the same file you are. Take the correction as fact, "
            "find what they are pointing at, and read that part again carefully.\n"
        )

    collected: list = []
    errors: list[str] = []
    for f in files:
        data = await read_upload(f, what='file')
        try:
            parsed = ai_import.ai_extract_json(data, f.filename or "", f.content_type, instruction)
        except RuntimeError as e:
            errors.append(f"{f.filename}: {e}")
            continue
        got = (parsed or {}).get(out_key) if isinstance(parsed, dict) else None
        if isinstance(got, list):
            collected.extend(got)
    if out_key == "team_stats":
        # A panel of Nones would replace the one on screen with two team names
        # and no bars — the coach asked for a re-read and got an emptier chart.
        collected = [r for r in collected if isinstance(r, dict)
                     and any(_as_int(r.get(k)) is not None for k in _PANEL_KEYS)]
    if section == "advanced":
        # Saving a row that states PTS and REB and none of the five would leave
        # the card exactly as blank as it was, and say nothing about why.
        collected = [r for r in collected
                     if any(_as_int(r.get(k)) is not None for k in _ADVANCED_KEYS)]
        if not collected:
            raise HTTPException(
                status_code=422,
                detail="Those five numbers — points off turnovers, fast break, second "
                       "chance, points in the paint and bench points — were not found "
                       "in that file. They cannot be worked out from a box score. "
                       "Nothing was changed."
                       + (" " + "; ".join(errors) if errors else ""))
    if not collected:
        raise HTTPException(
            status_code=422,
            detail="That section could not be read from those files."
                   + (" " + "; ".join(errors) if errors else ""))

    sides: dict[str, bool] = {}
    unresolved: list[str] = []
    for r in collected:
        if not isinstance(r, dict):
            continue
        label = str(r.get("team_name") or "").strip()
        matched = _side_for(label, ours_name, game.opponent_name or "")
        if matched is None:
            # Unmatched used to fall through to our side, which is how a re-read
            # of one panel could quietly move the other team's numbers onto ours.
            if (label or "(no heading)") not in unresolved:
                unresolved.append(label or "(no heading)")
        else:
            sides[label] = matched
    # The OUTPUT key, not the one that was asked for: 'advanced' is a narrower
    # read of the same team-totals panel, and it is that panel it must be saved
    # back into.
    return {"section": out_key, "count": len(collected), "rows": collected,
            "sides": sides, "unresolved": unresolved, "errors": errors}
