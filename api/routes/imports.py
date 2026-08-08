"""Unified AI-powered imports: every "Import" button posts any file here, the
model extracts structured rows, the app shows a preview, and a separate commit
endpoint writes the confirmed data. Deterministic writes stay server-side; only
the messy file → rows step is AI."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
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
                      "is_opponent": bool(p.get("is_opponent")), "stats": norm})

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
    # Events, shots and team totals are not reviewed row by row — a coach is not
    # going to tick four hundred play-by-play lines — so they travel with the
    # preview and are counted for them instead.
    return {
        "players": list(merged.values()),
        "events": events, "shots": shots, "team_stats": team_stats,
        "found": {"players": len(merged), "events": len(events),
                  "shots": len(shots), "team_stats": len(team_stats)},
        "errors": errors,
    }


class GameStatsCommit(BaseModel):
    game_id: int
    players: list[dict] = []
    # Everything else the files held, passed back untouched from the preview.
    events: list[dict] = []
    shots: list[dict] = []
    team_stats: list[dict] = []


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
    _clear_prior_import(db, game.id)
    imported = 0
    for p in body.players:
        name = str(p.get("player_name") or "").strip()
        if not name:
            continue
        is_opp = bool(p.get("is_opponent"))
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

    def side_for(team_name) -> bool:
        return side_of.get(str(team_name or "").strip().lower(), False)

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
        db.query(models.GamePlayEvent).filter_by(game_id=game.id).delete()
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
        db.query(models.GameShot).filter_by(game_id=game.id).delete()
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
        db.query(models.GameTeamAdvanced).filter_by(game_id=game.id).delete()
        for ts in body.team_stats:
            if not isinstance(ts, dict):
                continue
            db.add(models.GameTeamAdvanced(
                game_id=game.id, is_opponent=side_for(ts.get("team_name")),
                points_off_turnovers=_as_int(ts.get("points_off_turnovers")),
                fast_break_points=_as_int(ts.get("fast_break_points")),
                second_chance_points=_as_int(ts.get("second_chance_points")),
                points_in_paint=_as_int(ts.get("points_in_paint")),
                bench_points=_as_int(ts.get("bench_points")),
            ))
            advanced_in += 1

    db.commit()
    return {"imported": imported, "events": events_in, "shots": shots_in,
            "team_stats": advanced_in}


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
