"""Game Evaluation routes — BIM game-by-game grading system."""

import difflib
import io
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..auth import get_current_coach
from ..report_format import REPORT_FORMAT, REPORT_FORMAT_WITH_TABLES
from .. import models, schemas
from ..softdelete import soft_delete
from ..ai_models import OPUS, long_text
from ..uploadguard import read_upload
from .. import genjob

router = APIRouter(prefix="/game-eval", tags=["game-eval"])

# ── Stat definitions ──────────────────────────────────────────────────────────

OFFENSE_STATS: dict[str, dict] = {
    "2 FG Made":      {"base_low": 2,  "base_high": 3,  "threshold": 4},
    "2 FG Missed":    {"base_low": -1, "base_high": -2, "threshold": 4},
    "3 FG Made":      {"base_low": 3,  "base_high": 4,  "threshold": 4},
    "3 FG Missed":    {"base_low": -1, "base_high": -2, "threshold": 4},
    "Off. Reb":       {"base_low": 3,  "base_high": 4,  "threshold": 4},
    "Draw PF":        {"base_low": 1,  "base_high": 1,  "threshold": 4},
    "Assists":        {"base_low": 3,  "base_high": 4,  "threshold": 4},
    "Turnover":       {"base_low": -2, "base_high": -2, "threshold": 4},
    "Hockey Assist":  {"base_low": 2,  "base_high": 2,  "threshold": 4},
    "FT Made":        {"base_low": 2,  "base_high": 3,  "threshold": 4},
    "FT Missed":      {"base_low": -1, "base_high": -2, "threshold": 4},
}

DEFENSE_STATS: dict[str, dict] = {
    "Def. Reb":          {"base_low": 3,  "base_high": 4,  "threshold": 4},
    "Steal":             {"base_low": 3,  "base_high": 4,  "threshold": 4},
    "Deflection":        {"base_low": 3,  "base_high": 4,  "threshold": 4},
    "Def. Stop":         {"base_low": 3,  "base_high": 3,  "threshold": 4},
    "Charge":            {"base_low": 5,  "base_high": 7,  "threshold": 4},
    "Bluff":             {"base_low": 1,  "base_high": 1,  "threshold": 4},
    "Blocked Shot":      {"base_low": 2,  "base_high": 2,  "threshold": 4},
    "Jog Back":          {"base_low": -3, "base_high": -3, "threshold": 4},
    "No Ball Pressure":  {"base_low": -1, "base_high": -1, "threshold": 4},
    "Defensive Mistake": {"base_low": -1, "base_high": -1, "threshold": 4},
    "No Contest":        {"base_low": -1, "base_high": -1, "threshold": 4},
    "No Block Out":      {"base_low": -1, "base_high": -1, "threshold": 4},
    "Foul Against":      {"base_low": -1, "base_high": -1, "threshold": 4},
}

ALL_STAT_NAMES = list(OFFENSE_STATS.keys()) + list(DEFENSE_STATS.keys())


def stat_category(stat_name: str) -> str:
    """The only correct source of a stat's category.

    Every consumer — grades, quarter splits, the BIM composite, the prompt
    blocks — buckets rows by "offense"/"defense". A row stored under any other
    value is silently dropped from the off/def sums and raises a KeyError in the
    per-quarter split, so this must never be derived from the sign of the
    points: a missed shot is negative but still offense.
    """
    return "defense" if stat_name in DEFENSE_STATS else "offense"


def _quarter_multiplier(quarter: int) -> float:
    if quarter <= 2:
        return 1.0
    elif quarter == 3:
        return 1.25
    else:  # Q4 or OT
        return 1.5


# ── Post-game box-score import ─────────────────────────────────────────────────
# Mirror of the app's STAT_POINTS: stat_name -> (base_low, base_high, threshold).
_IMPORT_STAT_POINTS: dict[str, tuple[int, int, int]] = {
    "2 FG Made": (2, 3, 4), "3 FG Made": (3, 4, 4), "FT Made": (2, 3, 4),
    "Off. Reb": (3, 4, 4), "Def. Reb": (3, 4, 4), "Assists": (3, 4, 4),
    "Steal": (3, 4, 4), "Blocked Shot": (2, 2, 4), "Turnover": (-2, -2, 4),
    "Foul Against": (-1, -1, 4),
}
# Header keyword -> stat_name (checked in order; first match wins).
_IMPORT_COL_MAP: list[tuple[str, str]] = [
    (r"^(3pm|3 ?fg ?made|3 ?pt ?made|3s ?made|threes ?made)", "3 FG Made"),
    (r"^(ftm|ft ?made|free ?throws? ?made)", "FT Made"),
    (r"^(2pm|2 ?fg ?made|fgm|fg ?made)", "2 FG Made"),
    (r"^(oreb|o\.? ?reb|off\.? ?reb|offensive ?reb)", "Off. Reb"),
    (r"^(dreb|d\.? ?reb|def\.? ?reb|defensive ?reb)", "Def. Reb"),
    (r"^(reb|rebounds?|trb)", "Def. Reb"),
    (r"^(ast|assists?)", "Assists"),
    (r"^(stl|steals?)", "Steal"),
    (r"^(blk|blocks?)", "Blocked Shot"),
    (r"^(to|tov|turnovers?)", "Turnover"),
    (r"^(pf|fouls?)", "Foul Against"),
]


# A box score covers the whole game, so it is stored under a neutral quarter
# with no clutch multiplier rather than being attributed to any one quarter.
IMPORT_QUARTER = 1
IMPORT_MULTIPLIER = 1.0


def _clear_prior_import(db: Session, game_id: int, is_opponent: bool | None = None) -> None:
    """Drop the previous imported box score for this game.

    Imports are whole-game totals, so importing twice would double every count.
    Only rows marked source="import" are removed — anything the coach tracked
    live during the game is left untouched.
    """
    q = db.query(models.GamePlayerStat).filter(
        models.GamePlayerStat.game_id == game_id,
        models.GamePlayerStat.source == "import",
    )
    if is_opponent is not None:
        q = q.filter(models.GamePlayerStat.is_opponent == is_opponent)
    q.delete(synchronize_session=False)


def _import_raw(stat: str, count: int) -> float:
    cfg = _IMPORT_STAT_POINTS.get(stat)
    if not cfg:
        return 0.0
    low, high, thr = cfg
    return float((high if count >= thr else low) * count)


@router.post("/sessions/{game_id}/import")
async def import_game_stats(
    game_id: int,
    file: UploadFile = File(...),
    is_opponent: bool = False,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Import a post-game box score (Excel/CSV): one row per player, stat columns
    mapped to the BIM stat vocabulary and recorded as full-game (Q4) entries."""
    import re
    import openpyxl

    game = _get_game(db, game_id, coach.id)
    content = await read_upload(file, what='spreadsheet')
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        rows = [list(r) for r in wb.active.iter_rows(values_only=True)]
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read spreadsheet. Use .xlsx.")
    if not rows:
        raise HTTPException(status_code=400, detail="The file is empty.")

    header = [str(c).strip().lower() if c is not None else "" for c in rows[0]]
    name_idx = next((i for i, h in enumerate(header) if h in ("name", "player", "player name", "athlete", "#")), 0)
    col_stats: dict[int, str] = {}
    for i, h in enumerate(header):
        for pat, stat in _IMPORT_COL_MAP:
            if re.match(pat, h):
                col_stats[i] = stat
                break
    if not col_stats:
        raise HTTPException(status_code=400, detail="No recognizable stat columns (PTS/REB/AST/…) found.")

    # A box score is whole-game totals, not a Q4 performance: recording it under
    # quarter 4 would apply the 1.5x clutch multiplier to the entire game and
    # inflate every imported game against live-tracked ones.
    q, mult = IMPORT_QUARTER, IMPORT_MULTIPLIER
    _clear_prior_import(db, game.id, is_opponent)
    imported = 0
    for row in rows[1:]:
        if name_idx >= len(row) or not row[name_idx] or not str(row[name_idx]).strip():
            continue
        pname = str(row[name_idx]).strip()
        for i, stat in col_stats.items():
            if i >= len(row):
                continue
            try:
                count = int(float(row[i]))
            except (TypeError, ValueError):
                continue
            if count <= 0:
                continue
            raw = _import_raw(stat, count)
            db.add(models.GamePlayerStat(
                game_id=game.id, player_name=pname, is_opponent=is_opponent,
                quarter=q, stat_name=stat, stat_category=stat_category(stat),
                raw_points=raw, quarter_multiplier=mult, weighted_points=raw * mult, count=count,
                source="import",
            ))
            imported += 1
    db.commit()
    return {"imported": imported}


def _compute_raw_points(stat_name: str, count: int) -> tuple[float, str]:
    """Returns (raw_points, category)."""
    if stat_name in OFFENSE_STATS:
        cfg = OFFENSE_STATS[stat_name]
        cat = "offense"
    elif stat_name in DEFENSE_STATS:
        cfg = DEFENSE_STATS[stat_name]
        cat = "defense"
    else:
        return (0.0, "offense")
    pv = cfg["base_high"] if count >= cfg["threshold"] else cfg["base_low"]
    return (float(pv * count), cat)


def player_tracked_stats_block(db, coach_id: int, player_name: str, game_ids) -> str:
    """Format a player's real tracked box-score stats for the given games into a
    prompt block. Shared by player summaries and new evals."""
    if not game_ids:
        return ""
    gstats = (
        db.query(models.GamePlayerStat)
        .join(models.GameSession, models.GameSession.id == models.GamePlayerStat.game_id)
        .filter(
            models.GameSession.coach_id == coach_id,
            models.GameSession.id.in_(list(game_ids)),
            models.GamePlayerStat.player_name == player_name,
            models.GamePlayerStat.is_opponent == False,
        )
        .all()
    )
    by_game: dict = {}
    for s in gstats:
        by_game.setdefault(s.game_id, []).append(s)
    lines = []
    for gid in game_ids:
        gs = by_game.get(gid)
        if not gs:
            continue
        game = db.get(models.GameSession, gid)
        counts: dict = {}
        for s in gs:
            counts[s.stat_name] = counts.get(s.stat_name, 0) + (s.count or 0)
        pts = counts.get("2 FG Made", 0) * 2 + counts.get("3 FG Made", 0) * 3 + counts.get("FT Made", 0)
        reb = counts.get("Off. Reb", 0) + counts.get("Def. Reb", 0)
        statline = ", ".join(f"{k}: {v}" for k, v in counts.items())
        when = game.date.strftime("%Y-%m-%d") if game and game.date else ""
        opp = game.opponent_name if game else "opponent"
        lines.append(
            f"vs {opp} ({when}) — PTS {pts}, REB {reb}, AST {counts.get('Assists', 0)}, "
            f"STL {counts.get('Steal', 0)}, BLK {counts.get('Blocked Shot', 0)}, TO {counts.get('Turnover', 0)}\n   {statline}"
        )
    if not lines:
        return ""
    return (
        "\n\nTRACKED GAME STATS (real box-score data from tracked games — build the box "
        "score from THESE numbers and reference them):\n" + "\n".join(lines)
    )


def _get_game(db: Session, game_id: int, coach_id: int) -> models.GameSession:
    game = db.get(models.GameSession, game_id)
    if not game or game.coach_id != coach_id:
        raise HTTPException(status_code=404, detail="Game session not found")
    return game


def _accessible_team_ids(db: Session, coach: models.Coach) -> set[int]:
    """Teams a coach can see games for: teams they own + teams they've joined
    as staff."""
    ids = {tm.id for tm in db.query(models.Team).filter_by(coach_id=coach.id).all()}
    ids |= {l.team_id for l in db.query(models.TeamStaff).filter_by(coach_id=coach.id).all()}
    return ids


def _coach_scouting(db: Session, coach: models.Coach, game: models.GameSession) -> str | None:
    """The coach's OWN scouting report for a game. Each coach who can access a
    game keeps their own private scouting; the owner's legacy report (stored on
    the game row before per-coach reports existed) is their own report."""
    row = (
        db.query(models.GameScoutingReport)
        .filter_by(game_id=game.id, coach_id=coach.id)
        .first()
    )
    if row and row.report_text:
        return row.report_text
    if game.coach_id == coach.id and game.ai_scouting_report:
        return game.ai_scouting_report
    return None


def _upsert_scouting(db: Session, coach: models.Coach, game: models.GameSession, text: str) -> None:
    row = (
        db.query(models.GameScoutingReport)
        .filter_by(game_id=game.id, coach_id=coach.id)
        .first()
    )
    if row:
        row.report_text = text
    else:
        db.add(models.GameScoutingReport(game_id=game.id, coach_id=coach.id, report_text=text))
    # Keep the legacy field in sync for the owner so older consumers still work.
    if game.coach_id == coach.id:
        game.ai_scouting_report = text


def _coach_game_report(db: Session, coach: models.Coach, game: models.GameSession) -> str | None:
    """The coach's OWN full game report for a game (per-coach, private)."""
    row = (
        db.query(models.GameFullReport)
        .filter_by(game_id=game.id, coach_id=coach.id)
        .first()
    )
    return row.report_text if row and row.report_text else None


def _upsert_game_report(db: Session, coach: models.Coach, game: models.GameSession, text: str) -> None:
    row = (
        db.query(models.GameFullReport)
        .filter_by(game_id=game.id, coach_id=coach.id)
        .first()
    )
    if row:
        row.report_text = text
    else:
        db.add(models.GameFullReport(game_id=game.id, coach_id=coach.id, report_text=text))


VERSIONS_KEPT = 20


def _file_edits(db: Session, game, coach: models.Coach, edits: list[str],
                remember: bool, correction_model) -> None:
    """Keep what the coach typed, in whichever drawer they chose.

    The endpoint does this rather than the screen. When the screen owned it, a
    caller that did not happen to save the note first would have the text
    applied to the report and stored nowhere — it would shape this one
    regeneration and then be gone.
    """
    for text in edits:
        if remember and game.opponent_name:
            db.add(models.OpponentNote(coach_id=coach.id,
                                       opponent_name=game.opponent_name, note_text=text))
        else:
            db.add(correction_model(game_id=game.id, coach_id=coach.id, correction=text))
    if edits:
        db.commit()


def _edits_from_body(body: dict | None) -> list[str]:
    """The change the coach typed alongside the button they pressed."""
    if not body:
        return []
    text = (body.get("feedback") or body.get("text") or "").strip()
    return [text] if text else []


def _snapshot_report(db: Session, game_id: int, coach_id: int, kind: str, text: str) -> None:
    """Keep the wording about to be replaced.

    Only worth doing because regeneration now EDITS rather than rebuilds: while
    every regeneration was written fresh from the box score, a lost report could
    always be made again. An edited one cannot — the wording was the work.
    """
    if not (text or "").strip():
        return
    db.add(models.GameSessionReportVersion(
        game_id=game_id, coach_id=coach_id, kind=kind, report_text=text))
    db.flush()
    old = (db.query(models.GameSessionReportVersion)
             .filter_by(game_id=game_id, coach_id=coach_id, kind=kind)
             .order_by(models.GameSessionReportVersion.id.desc())
             .offset(VERSIONS_KEPT).all())
    for row in old:
        db.delete(row)


async def _apply_edits(prior_text: str, edits: list[str], coach: models.Coach,
                       on_words=None) -> str:
    """The report the coach already has, with the changes they asked for.

    The alternative — and what this replaced — was to write the report again
    from the box score and all accumulated context. That kept the report
    perfectly consistent with the numbers, and threw away everything about the
    existing one: a coach asking for one line to be corrected got a wholly
    different report back, with every observation reworded. Their context was
    never lost, but the report was.
    """
    from ..coach_context import language_directive

    prompt = (
        "Below is a basketball report, followed by changes the coach has asked for. "
        "Apply ALL of the changes.\n\n"
        "EDIT the report — do not rewrite it. Everything the changes do not touch must come "
        "back exactly as it is: same sections in the same order, same wording, same tables. "
        "Add what they ask to be added, remove what they ask to be removed, and correct what "
        "they say is wrong. Where a change contradicts the report, the coach saw the game and "
        "is right.\n\n"
        "Return ONLY the updated report, in the same format, with no preamble.\n\n"
        f"REPORT:\n{prior_text}\n\nCHANGES REQUESTED:\n"
        + "\n".join(f"- {e}" for e in edits)
        + f"{language_directive(coach)}"
    )
    return await long_text(prompt, max_tokens=12000, on_words=on_words)


def _scouting_text_for(db: Session, game_id: int, coach_id: int) -> str:
    """The scouting report this coach has on this game, for a finished job to
    hand back in the shape the screen already reads."""
    row = db.query(models.GameScoutingReport).filter_by(game_id=game_id, coach_id=coach_id).first()
    return row.report_text if row else ""


def _game_report_text_for(db: Session, game_id: int, coach_id: int) -> str:
    row = db.query(models.GameFullReport).filter_by(game_id=game_id, coach_id=coach_id).first()
    return row.report_text if row else ""


def _gate_scouting(db: Session, coach: models.Coach, game: models.GameSession) -> schemas.GameSessionOut:
    """Serialize a game with the CURRENT coach's own scouting report. Staff see
    the game's stats/grades but only their own scouting write-up (empty until
    they generate one); scouting shared to them surfaces via Recent/Staff Hub."""
    out = schemas.GameSessionOut.model_validate(game)
    out.ai_scouting_report = _coach_scouting(db, coach, game)
    if out.ai_scouting_report:
        row = (
            db.query(models.GameScoutingReport)
            .filter_by(game_id=game.id, coach_id=coach.id)
            .first()
        )
        out.scouting_updated_at = (row.updated_at or row.created_at) if row else game.date
    out.ai_game_report = _coach_game_report(db, coach, game)
    if out.ai_game_report:
        grow = (
            db.query(models.GameFullReport)
            .filter_by(game_id=game.id, coach_id=coach.id)
            .first()
        )
        out.game_report_updated_at = (grow.updated_at or grow.created_at) if grow else game.date
    return out


def _get_game_readable(db: Session, game_id: int, coach: models.Coach) -> models.GameSession:
    """Read access to a game: the owner, or any staff member linked to the
    game's team. Staff can view full game data (stats, grades, scouting) but
    editing stays owner-only via _get_game."""
    game = db.get(models.GameSession, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game session not found")
    if game.coach_id == coach.id:
        return game
    if game.team_id is not None and game.team_id in _accessible_team_ids(db, coach):
        return game
    raise HTTPException(status_code=404, detail="Game session not found")


# ── Sessions ─────────────────────────────────────────────────────────────────

@router.post("/sessions", response_model=schemas.GameSessionOut)
def create_session(
    body: schemas.GameSessionCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = models.GameSession(
        coach_id=coach.id,
        opponent_name=body.opponent_name,
        team_id=body.team_id,
        location=body.location,
        season_phase=body.season_phase,
        season_year=body.season_year,
        tracking_mode=body.tracking_mode,
        competition_level=body.competition_level,
        period_format=body.period_format or "quarters",
        num_periods=body.num_periods or 4,
        period_seconds=body.period_seconds or 480,
    )
    if body.date:
        try:
            game.date = datetime.fromisoformat(body.date)
        except ValueError:
            pass

    # Season-change nudge (activity-based) + activity stamp.
    from ..season import touch_and_maybe_remind
    game_year = (body.season_year or "").strip() or (str(game.date.year) if getattr(game, "date", None) else "")
    touch_and_maybe_remind(db, coach, game_year or None)

    db.add(game)
    db.commit()
    db.refresh(game)
    return game


@router.get("/sessions", response_model=list[schemas.GameSessionOut])
def list_sessions(
    season_phase: str | None = None,
    season_year: str | None = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    # A coach sees their own games plus games on any team they're linked to as
    # staff, so a team's schedule shows up in the Team Grade tab for all staff.
    from sqlalchemy import or_
    team_ids = _accessible_team_ids(db, coach)
    conds = [models.GameSession.coach_id == coach.id]
    if team_ids:
        conds.append(models.GameSession.team_id.in_(team_ids))
    q = db.query(models.GameSession).filter(or_(*conds))
    if season_phase:
        q = q.filter(models.GameSession.season_phase == season_phase)
    if season_year:
        q = q.filter(models.GameSession.season_year == season_year)
    games = q.order_by(models.GameSession.date.desc()).all()
    # Gate each game's written scouting report: staff see the game's stats but
    # only see the AI scouting write-up if it was shared to them.
    return [_gate_scouting(db, coach, g) for g in games]


@router.get("/sessions/{game_id}", response_model=schemas.GameSessionOut)
def get_session(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    return _gate_scouting(db, coach, _get_game_readable(db, game_id, coach))


@router.patch("/sessions/{game_id}", response_model=schemas.GameSessionOut)
def update_session(
    game_id: int,
    body: schemas.GameSessionUpdate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game(db, game_id, coach.id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(game, field, value)
    db.commit()
    db.refresh(game)
    return game


@router.delete("/sessions/{game_id}")
def delete_session(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game(db, game_id, coach.id)
    # Hidden, not destroyed — a tracked game carries a whole night's stats.
    soft_delete(db, game)
    db.commit()
    return {"ok": True}


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/sessions/{game_id}/stats")
def list_stats(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game_readable(db, game_id, coach)
    stats = (
        db.query(models.GamePlayerStat)
        .filter_by(game_id=game.id)
        .order_by(models.GamePlayerStat.id)
        .all()
    )
    return [
        {
            "id": s.id,
            "player_name": s.player_name,
            "is_opponent": s.is_opponent,
            "quarter": s.quarter,
            "stat_name": s.stat_name,
            "stat_category": s.stat_category,
            "raw_points": s.raw_points,
            "weighted_points": s.weighted_points,
            "count": s.count,
        }
        for s in stats
    ]


@router.post("/sessions/{game_id}/stats")
def log_stat(
    game_id: int,
    body: schemas.GameStatEntry,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game(db, game_id, coach.id)
    multiplier = _quarter_multiplier(body.quarter)
    weighted = body.raw_points * multiplier
    stat = models.GamePlayerStat(
        game_id=game.id,
        player_id=body.player_id,
        player_name=body.player_name,
        is_opponent=body.is_opponent,
        quarter=body.quarter,
        stat_name=body.stat_name,
        stat_category=body.stat_category,
        raw_points=body.raw_points,
        quarter_multiplier=multiplier,
        weighted_points=weighted,
        count=body.count,
    )
    db.add(stat)
    db.commit()
    db.refresh(stat)
    return {"id": stat.id, "weighted_points": weighted}


@router.delete("/stats/{stat_id}")
def delete_stat(
    stat_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    stat = db.get(models.GamePlayerStat, stat_id)
    if not stat:
        raise HTTPException(status_code=404, detail="Stat not found")
    # Verify ownership via game
    game = db.get(models.GameSession, stat.game_id)
    if not game or game.coach_id != coach.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    db.delete(stat)
    db.commit()
    return {"ok": True}


# ── Lineup ────────────────────────────────────────────────────────────────────

@router.post("/sessions/{game_id}/lineup")
def log_lineup(
    game_id: int,
    body: schemas.LineupEventCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game(db, game_id, coach.id)
    event = models.LineupEvent(
        game_id=game.id,
        player_id=body.player_id,
        player_name=body.player_name,
        is_opponent=body.is_opponent,
        event_type=body.event_type,
        quarter=body.quarter,
        timestamp_seconds=body.timestamp_seconds,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return {"id": event.id}


@router.get("/sessions/{game_id}/lineup")
def get_lineup(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game_readable(db, game_id, coach)
    events = (
        db.query(models.LineupEvent)
        .filter_by(game_id=game.id)
        .order_by(models.LineupEvent.created_at)
        .all()
    )
    return [
        {
            "id": e.id,
            "player_name": e.player_name,
            "is_opponent": e.is_opponent,
            "event_type": e.event_type,
            "quarter": e.quarter,
            "timestamp_seconds": e.timestamp_seconds,
        }
        for e in events
    ]


# ── Minutes ───────────────────────────────────────────────────────────────────

@router.post("/sessions/{game_id}/minutes")
def log_minutes(
    game_id: int,
    body: schemas.GameMinutesEntry,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game(db, game_id, coach.id)
    existing = (
        db.query(models.GameMinutesPlayed)
        .filter_by(game_id=game.id, player_name=body.player_name, is_opponent=body.is_opponent)
        .first()
    )
    if existing:
        existing.minutes_played = body.minutes_played
    else:
        mp = models.GameMinutesPlayed(
            game_id=game.id,
            player_id=body.player_id,
            player_name=body.player_name,
            is_opponent=body.is_opponent,
            minutes_played=body.minutes_played,
        )
        db.add(mp)
    db.commit()
    return {"ok": True}


# ── Summary ───────────────────────────────────────────────────────────────────

def _compute_grades(stats: list[models.GamePlayerStat], minutes_map: dict[str, float]) -> list[dict]:
    player_data: dict[str, dict] = {}
    for s in stats:
        if s.player_name not in player_data:
            player_data[s.player_name] = {
                "offensive_weighted": 0.0,
                "defensive_weighted": 0.0,
                "quarters": defaultdict(lambda: {"offense": 0.0, "defense": 0.0}),
            }
        pd = player_data[s.player_name]
        if s.stat_category == "offense":
            pd["offensive_weighted"] += s.weighted_points
        else:
            pd["defensive_weighted"] += s.weighted_points
        pd["quarters"][s.quarter][s.stat_category] += s.weighted_points

    grades = []
    for name, data in player_data.items():
        mins = minutes_map.get(name, 20.0)  # default 20 min if not recorded
        total = data["offensive_weighted"] + data["defensive_weighted"]
        game_grade = round(total / max(mins, 1.0), 2)
        grades.append({
            "player_name": name,
            "offensive_grade": round(data["offensive_weighted"], 2),
            "defensive_grade": round(data["defensive_weighted"], 2),
            "total_grade": round(total, 2),
            "minutes_played": round(mins, 1),
            "game_grade": game_grade,
            "plus_minus": 0,  # computed separately if lineup timestamps available
            "per_quarter": {str(q): dict(v) for q, v in data["quarters"].items()},
        })
    grades.sort(key=lambda x: x["game_grade"], reverse=True)
    return grades


@router.get("/sessions/{game_id}/summary")
def get_summary(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game_readable(db, game_id, coach)

    # Minutes map
    mp_records = db.query(models.GameMinutesPlayed).filter_by(game_id=game.id).all()
    our_minutes = {r.player_name: r.minutes_played for r in mp_records if not r.is_opponent}
    opp_minutes = {r.player_name: r.minutes_played for r in mp_records if r.is_opponent}

    our_stats = [s for s in game.player_stats if not s.is_opponent]
    opp_stats = [s for s in game.player_stats if s.is_opponent]

    player_grades = _compute_grades(our_stats, our_minutes)
    opponent_grades = _compute_grades(opp_stats, opp_minutes)

    # Team grade
    if player_grades:
        avg_player_grade = sum(g["game_grade"] for g in player_grades) / len(player_grades)
    else:
        avg_player_grade = 0.0

    win_loss_factor = 5.0
    if game.our_score is not None and game.opponent_score is not None:
        if game.our_score > game.opponent_score:
            win_loss_factor = 10.0
        elif abs(game.our_score - game.opponent_score) <= 5:
            win_loss_factor = 7.0
        else:
            win_loss_factor = 5.0

    team_grade = round((avg_player_grade * 0.6) + (win_loss_factor * 0.4), 2)

    game_out = _gate_scouting(db, coach, game)
    return {
        "game": game_out.model_dump(),
        "player_grades": player_grades,
        "team_grade": team_grade,
        "opponent_grades": opponent_grades,
    }


@router.get("/player-game-history")
def player_game_history(
    player_name: str,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """All games this player appeared in, with per-game stats and grade.
    Covers the coach's own games plus games on teams they're staff on, so the
    Team Grade leaderboard detail works for shared team schedules."""
    from sqlalchemy import or_
    team_ids = _accessible_team_ids(db, coach)
    game_conds = [models.GameSession.coach_id == coach.id]
    if team_ids:
        game_conds.append(models.GameSession.team_id.in_(team_ids))
    stats = (
        db.query(models.GamePlayerStat)
        .join(models.GameSession, models.GameSession.id == models.GamePlayerStat.game_id)
        .filter(
            or_(*game_conds),
            models.GamePlayerStat.player_name == player_name,
            models.GamePlayerStat.is_opponent == False,
        )
        .all()
    )

    game_ids = sorted({s.game_id for s in stats}, reverse=True)
    result = []
    for game_id in game_ids:
        game = db.get(models.GameSession, game_id)
        if not game:
            continue
        gs = [s for s in stats if s.game_id == game_id]

        off_w = sum(s.weighted_points for s in gs if s.stat_category == "offense")
        def_w = sum(s.weighted_points for s in gs if s.stat_category == "defense")
        total_w = off_w + def_w

        mp_rec = (
            db.query(models.GameMinutesPlayed)
            .filter_by(game_id=game_id, player_name=player_name, is_opponent=False)
            .first()
        )
        minutes = mp_rec.minutes_played if mp_rec else 20.0
        game_grade = round(total_w / max(minutes, 1.0), 2)

        stat_breakdown: dict = {}
        for s in gs:
            if s.stat_name not in stat_breakdown:
                stat_breakdown[s.stat_name] = {"count": 0, "weighted_points": 0.0, "category": s.stat_category}
            stat_breakdown[s.stat_name]["count"] += s.count
            stat_breakdown[s.stat_name]["weighted_points"] += round(s.weighted_points, 2)

        quarters: dict = {}
        for s in gs:
            q = str(s.quarter)
            if q not in quarters:
                quarters[q] = {"offense": 0.0, "defense": 0.0, "stats": []}
            quarters[q][s.stat_category] = round(quarters[q][s.stat_category] + s.weighted_points, 2)
            quarters[q]["stats"].append({
                "name": s.stat_name,
                "count": s.count,
                "weighted_points": round(s.weighted_points, 2),
                "category": s.stat_category,
            })

        result.append({
            "game_id": game.id,
            "opponent_name": game.opponent_name,
            "date": game.date.strftime("%B %d, %Y") if game.date else None,
            "year": game.date.year if game.date else None,
            "season_year": game.season_year,
            "our_score": game.our_score,
            "opponent_score": game.opponent_score,
            "season_phase": game.season_phase,
            "game_grade": game_grade,
            "offensive_weighted": round(off_w, 2),
            "defensive_weighted": round(def_w, 2),
            "minutes": round(minutes, 1),
            "stat_breakdown": stat_breakdown,
            "per_quarter": quarters,
        })

    return result


# ── Upload Excel ──────────────────────────────────────────────────────────────

@router.post("/sessions/{game_id}/upload")
async def upload_excel(
    game_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game(db, game_id, coach.id)
    content = await read_upload(file, what='spreadsheet')

    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read Excel file: {e}")

    _clear_prior_import(db, game.id)
    imported = 0
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        # Find header row with player names
        header_row_idx = None
        player_cols: dict[int, str] = {}  # col_idx -> player_name
        for i, row in enumerate(rows):
            for j, cell in enumerate(row):
                if cell and "Game Grade" in str(cell):
                    header_row_idx = i
                    break
            if header_row_idx is not None:
                break

        if header_row_idx is None:
            # Try first row as header
            header_row_idx = 0

        header_row = rows[header_row_idx]
        for j, cell in enumerate(header_row):
            val = str(cell).strip() if cell else ""
            if val and val not in ("", "None", "Stat", "Game Grade Sheet"):
                player_cols[j] = val

        # Parse stat rows
        for row in rows[header_row_idx + 1:]:
            if not row or not row[0]:
                continue
            stat_raw = str(row[0]).strip()
            if not stat_raw:
                continue

            # Fuzzy match stat name
            matches = difflib.get_close_matches(stat_raw, ALL_STAT_NAMES, n=1, cutoff=0.6)
            if not matches:
                continue
            stat_name = matches[0]
            cat = stat_category(stat_name)

            for col_idx, player_name in player_cols.items():
                if col_idx >= len(row):
                    continue
                val = row[col_idx]
                if val is None:
                    continue
                try:
                    count = int(float(str(val)))
                except (ValueError, TypeError):
                    continue
                if count == 0:
                    continue

                raw_points, _ = _compute_raw_points(stat_name, count)
                weighted = raw_points * IMPORT_MULTIPLIER

                stat = models.GamePlayerStat(
                    game_id=game.id,
                    player_name=player_name,
                    is_opponent="opp" in sheet_name.lower() or "opponent" in sheet_name.lower(),
                    quarter=IMPORT_QUARTER,
                    stat_name=stat_name,
                    stat_category=cat,
                    raw_points=raw_points,
                    quarter_multiplier=IMPORT_MULTIPLIER,
                    weighted_points=weighted,
                    count=count,
                    source="import",
                )
                db.add(stat)
                imported += 1

    db.commit()
    return {"imported": imported}


# ── AI Scouting Report ────────────────────────────────────────────────────────

async def _run_scouting(db: Session, coach: models.Coach, game: models.GameSession,
                        corrections: list[str], on_words=None) -> str:
    """Build + run the scouting report from the box score plus any coach-added
    context ('corrections'), upsert it for this coach, and return the text."""
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured.")

    opp_stats = [s for s in game.player_stats if s.is_opponent]
    opp_summary: dict[str, dict] = {}
    for s in opp_stats:
        if s.player_name not in opp_summary:
            opp_summary[s.player_name] = {"offense": 0.0, "defense": 0.0, "stats": defaultdict(int)}
        opp_summary[s.player_name][s.stat_category] += s.weighted_points
        opp_summary[s.player_name]["stats"][s.stat_name] += s.count

    opp_context = ""
    for pname, data in opp_summary.items():
        top_stats = sorted(data["stats"].items(), key=lambda x: x[1], reverse=True)[:5]
        opp_context += f"\n{pname}: OFF={data['offense']:.1f} DEF={data['defense']:.1f}  Top stats: {', '.join(f'{s}={c}' for s,c in top_stats)}"

    score_info = ""
    if game.our_score is not None and game.opponent_score is not None:
        result = "WIN" if game.our_score > game.opponent_score else "LOSS"
        score_info = f"Final score: {game.our_score}-{game.opponent_score} ({result})"

    notes = (
        db.query(models.OpponentNote)
        .filter_by(coach_id=coach.id, opponent_name=game.opponent_name)
        .order_by(models.OpponentNote.created_at)
        .all()
    )
    notes_text = ""
    if notes:
        notes_text = "\n\nCOACH NOTES (observed by coaching staff):\n" + "\n".join(f"- {n.note_text}" for n in notes)

    corr_text = ""
    if corrections:
        corr_text = (
            "\n\nCOACH CONTEXT & ADJUSTMENTS (qualitative detail the box score can't capture — "
            "you MUST weave ALL of these into the analysis and recommendations):\n"
            + "\n".join(f"- {c}" for c in corrections if c and c.strip())
        )

    from ..coach_context import resolve_level, language_directive
    _lvl = resolve_level(coach, team=(db.get(models.Team, game.team_id) if game.team_id else None))
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model. "
        f"Generate a pre-game scouting report for the opponent: {game.opponent_name}\n\n"
        f"Game date: {game.date}\n"
        f"COMPETITION LEVEL: {_lvl} — calibrate every read, tendency, and recommendation to this level.\n"
        f"{score_info}\n\n"
        f"OPPONENT PLAYER GRADES:\n{opp_context}"
        f"{notes_text}"
        f"{corr_text}\n\n"
        f"Analyze the opponent's strengths, weaknesses, top players to watch, offensive tendencies, "
        f"defensive tendencies, and strategic recommendations for the next game against them."
        f"{REPORT_FORMAT}"
        f"{language_directive(coach)}"
    )

    try:
        # Streamed. A non-streaming request carries a ten-minute SDK ceiling and
        # two silent retries behind it, so a report that ran long was abandoned
        # and paid for three times — see ai_models.long_text.
        report_text = await long_text(prompt, max_tokens=8000, on_words=on_words)
        if not report_text.strip():
            raise HTTPException(status_code=500, detail="AI returned no content")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    import re as _re
    report_text = _re.sub(r"\s*END OF REPORT\.?\s*$", "", report_text, flags=_re.IGNORECASE).rstrip()
    _upsert_scouting(db, coach, game, report_text)
    db.commit()
    return report_text


def _run_scouting_job(game_id: int, coach_id: int, job_id: int,
                      extra_edits: list[str] | None = None) -> None:
    """The scouting report, off the request that asked for it. See api/genjob.py.

    Always written from ALL of the coach's added context, and marks whatever was
    still pending as applied — which is what the "Apply & Regenerate" button did
    and what the first generation does with an empty list.
    """
    import asyncio

    def work():
        db = SessionLocal()
        try:
            game = db.get(models.GameSession, game_id)
            coach = db.get(models.Coach, coach_id)
            if not game or not coach:
                raise RuntimeError("Game not found")
            rows = (db.query(models.GameScoutingCorrection)
                      .filter_by(game_id=game_id, coach_id=coach_id)
                      .order_by(models.GameScoutingCorrection.id).all())
            prior = _scouting_text_for(db, game_id, coach_id)
            _snapshot_report(db, game_id, coach_id, "scouting", prior)
            edits = list(extra_edits or []) + [c.correction for c in rows if not c.applied]
            if prior and edits:
                text = asyncio.run(_apply_edits(prior, edits, coach,
                                                on_words=genjob.words_reporter(job_id)))
                _upsert_scouting(db, coach, game, text.strip())
            else:
                # No report to edit, or nothing new to apply — write it from the
                # box score and every piece of context on file.
                asyncio.run(_run_scouting(db, coach, game, [c.correction for c in rows],
                                          on_words=genjob.words_reporter(job_id)))
            for r in rows:
                r.applied = True
            db.commit()
        finally:
            db.close()
        return game_id

    genjob.run(job_id, work)


@router.get("/sessions/{game_id}/report-versions")
def list_report_versions(
    game_id: int,
    kind: str = "scouting",
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Previous wordings of this coach's report for this game, newest first."""
    _get_game_readable(db, game_id, coach)
    rows = (db.query(models.GameSessionReportVersion)
              .filter_by(game_id=game_id, coach_id=coach.id, kind=kind)
              .order_by(models.GameSessionReportVersion.id.desc()).all())
    return [{"id": r.id, "created_at": r.created_at, "report_text": r.report_text}
            for r in rows]


@router.post("/sessions/{game_id}/report-versions/{version_id}/restore")
def restore_report_version(
    game_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Put a previous wording back, keeping the current one as a version so
    restoring is itself reversible."""
    game = _get_game_readable(db, game_id, coach)
    row = db.get(models.GameSessionReportVersion, version_id)
    if not row or row.game_id != game_id or row.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="That version was not found.")
    current = (_scouting_text_for if row.kind == "scouting" else _game_report_text_for)(
        db, game_id, coach.id)
    _snapshot_report(db, game_id, coach.id, row.kind, current)
    if row.kind == "scouting":
        _upsert_scouting(db, coach, game, row.report_text or "")
        db.commit()
        return {"ai_scouting_report": row.report_text}
    _upsert_game_report(db, coach, game, row.report_text or "")
    db.commit()
    return {"report_text": row.report_text, "ai_game_report": row.report_text}


@router.post("/sessions/{game_id}/ai-scouting-job")
def start_ai_scouting(
    game_id: int,
    background_tasks: BackgroundTasks,
    body: dict | None = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Start the scouting report and hand back a job to follow.

    Serves both the first generation and "Apply & Regenerate": an optional
    feedback body is recorded as context before the report is written.
    """
    game = _get_game_readable(db, game_id, coach)
    # What the coach just typed is applied to the report whichever drawer it is
    # filed in. "Remember for this opponent" decides where the text is KEPT —
    # durable opponent note or one-off correction for this report — and used to
    # decide, as a side effect, whether it reached the report at all: a
    # remembered note was not a correction, so nothing was pending, so the
    # report was rebuilt and the note only landed because a rebuild reads notes
    # too. Once regeneration edits rather than rebuilds, that accident stops
    # working. The text is passed through explicitly instead.
    edits = _edits_from_body(body)
    _file_edits(db, game, coach, edits, bool((body or {}).get("remember")),
                models.GameScoutingCorrection)
    job = genjob.start(db, coach.id, "scouting",
                       {"game_id": game_id, "coach_id": coach.id, "edits": edits})
    background_tasks.add_task(_run_scouting_job, game_id, coach.id, job.id, edits)
    return {"job_id": job.id}


@router.post("/sessions/{game_id}/ai-scouting")
async def generate_ai_scouting(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Generate inline and wait. Kept for browser tabs loaded before the job
    endpoint above existed; new callers should use that one."""
    # Any coach who can access the game (owner or team staff) can generate their
    # OWN scouting report for it. Reports are per-coach and private until shared.
    game = _get_game_readable(db, game_id, coach)
    text = await _run_scouting(db, coach, game, [])
    return {"ai_scouting_report": text}


async def _run_game_report(db: Session, coach: models.Coach, game: models.GameSession,
                           corrections: list[str], on_words=None) -> str:
    """Build + run the full GAME REPORT (our team + opponent) from the box score
    plus opponent notes and any coach-added context, persist it for this coach,
    and return the text. Mirrors _run_scouting but covers both sides."""
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured.")

    def _side_context(is_opp: bool) -> str:
        summary: dict[str, dict] = {}
        for s in game.player_stats:
            if s.is_opponent != is_opp:
                continue
            d = summary.setdefault(s.player_name, {"off": 0.0, "def": 0.0, "stats": defaultdict(int)})
            d[("off" if s.stat_category == "offense" else "def")] += s.weighted_points
            d["stats"][s.stat_name] += s.count
        lines = ""
        for pname, d in summary.items():
            top = sorted(d["stats"].items(), key=lambda x: x[1], reverse=True)[:5]
            lines += f"\n{pname}: OFF={d['off']:.1f} DEF={d['def']:.1f}  {', '.join(f'{s}={c}' for s, c in top)}"
        return lines or "\n(no tracked stats)"

    team_row = db.get(models.Team, game.team_id) if game.team_id else None
    my_team = team_row.name if team_row else coach.program_name
    score_info = ""
    if game.our_score is not None and game.opponent_score is not None:
        res = "WIN" if game.our_score > game.opponent_score else ("LOSS" if game.our_score < game.opponent_score else "TIE")
        score_info = f"Final: {game.our_score}-{game.opponent_score} ({res})"

    notes = db.query(models.OpponentNote).filter_by(coach_id=coach.id, opponent_name=game.opponent_name).all()
    context = ""
    if notes:
        context += "\n\nCOACH NOTES ON THE OPPONENT:\n" + "\n".join(f"- {n.note_text}" for n in notes)
    if corrections:
        context += (
            "\n\nCOACH CONTEXT & ADJUSTMENTS (qualitative detail the box score can't capture — "
            "you MUST weave ALL of these into the analysis):\n"
            + "\n".join(f"- {c}" for c in corrections if c and c.strip())
        )

    from ..coach_context import resolve_level, language_directive
    _lvl = resolve_level(coach, team=team_row)
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model. Generate a full GAME REPORT for "
        f"{my_team} vs {game.opponent_name}.\n\nGame date: {game.date}\n"
        f"COMPETITION LEVEL: {_lvl} — calibrate every grade, comparison, and recommendation to this level.\n"
        f"{score_info}\n\n"
        f"OUR TEAM PLAYER GRADES:{_side_context(False)}\n\n"
        f"OPPONENT PLAYER GRADES:{_side_context(True)}"
        f"{context}\n\n"
        "Cover, in this order: 1) OUR TEAM PERFORMANCE — what worked, who stood out, where we broke down, "
        "and adjustments for next time; 2) OPPONENT BREAKDOWN — their tendencies, key players, how to attack "
        "and defend them going forward; 3) KEY TAKEAWAYS."
        f"{REPORT_FORMAT_WITH_TABLES}"
        f"{language_directive(coach)}"
    )
    try:
        # Streamed, for the reason given in _run_scouting.
        raw = await long_text(prompt, max_tokens=12000, on_words=on_words)
        if not raw.strip():
            raise HTTPException(status_code=500, detail="AI returned no content")
        import re as _re
        text = _re.sub(r"\s*END OF REPORT\.?\s*$", "", raw.strip(), flags=_re.IGNORECASE).rstrip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")
    _upsert_game_report(db, coach, game, text)
    db.commit()
    return text


def _game_report_corrections(db: Session, game_id: int, coach_id: int) -> list[str]:
    rows = (
        db.query(models.GameSessionReportCorrection)
        .filter_by(game_id=game_id, coach_id=coach_id)
        .order_by(models.GameSessionReportCorrection.id)
        .all()
    )
    return [c.correction for c in rows]


def _run_game_report_job(game_id: int, coach_id: int, job_id: int,
                         extra_edits: list[str] | None = None) -> None:
    """The full game report, off the request that asked for it. See api/genjob.py."""
    import asyncio

    def work():
        db = SessionLocal()
        try:
            game = db.get(models.GameSession, game_id)
            coach = db.get(models.Coach, coach_id)
            if not game or not coach:
                raise RuntimeError("Game not found")
            rows = (db.query(models.GameSessionReportCorrection)
                      .filter_by(game_id=game_id, coach_id=coach_id)
                      .order_by(models.GameSessionReportCorrection.id).all())
            prior = _game_report_text_for(db, game_id, coach_id)
            _snapshot_report(db, game_id, coach_id, "game_report", prior)
            edits = list(extra_edits or []) + [c.correction for c in rows if not c.applied]
            if prior and edits:
                text = asyncio.run(_apply_edits(prior, edits, coach,
                                                on_words=genjob.words_reporter(job_id)))
                _upsert_game_report(db, coach, game, text.strip())
            else:
                asyncio.run(_run_game_report(db, coach, game, [c.correction for c in rows],
                                             on_words=genjob.words_reporter(job_id)))
            for r in rows:
                r.applied = True
            db.commit()
        finally:
            db.close()
        return game_id

    genjob.run(job_id, work)


@router.post("/sessions/{game_id}/game-report-job")
def start_full_game_report(
    game_id: int,
    background_tasks: BackgroundTasks,
    body: dict | None = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Start the full game report and hand back a job to follow.

    Serves both the first generation and "Apply & Regenerate"; see the scouting
    equivalent above.
    """
    game = _get_game_readable(db, game_id, coach)
    edits = _edits_from_body(body)
    _file_edits(db, game, coach, edits, bool((body or {}).get("remember")),
                models.GameSessionReportCorrection)
    job = genjob.start(db, coach.id, "game_report_full",
                       {"game_id": game_id, "coach_id": coach.id, "edits": edits})
    background_tasks.add_task(_run_game_report_job, game_id, coach.id, job.id, edits)
    return {"job_id": job.id}


@router.post("/sessions/{game_id}/game-report")
async def generate_game_report(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """A full GAME REPORT — our team's performance AND the opponent, combined
    (vs the Scout Opponent report which is opponent-only). Persisted per-coach so
    it appears in Recents and feeds game packets.

    Generates inline and waits; kept for browser tabs loaded before the job
    endpoint above existed."""
    game = _get_game_readable(db, game_id, coach)
    all_corr = (
        db.query(models.GameSessionReportCorrection)
        .filter_by(game_id=game.id, coach_id=coach.id)
        .order_by(models.GameSessionReportCorrection.id)
        .all()
    )
    text = await _run_game_report(db, coach, game, [c.correction for c in all_corr])
    return {"report_text": text, "ai_game_report": text}


@router.get("/sessions/{game_id}/game-report-corrections")
def list_game_report_corrections(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    _get_game_readable(db, game_id, coach)
    rows = (
        db.query(models.GameSessionReportCorrection)
        .filter_by(game_id=game_id, coach_id=coach.id)
        .order_by(models.GameSessionReportCorrection.id)
        .all()
    )
    return [{"id": r.id, "correction": r.correction, "applied": r.applied, "created_at": r.created_at} for r in rows]


@router.post("/sessions/{game_id}/game-report-corrections")
def add_game_report_correction(
    game_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    _get_game_readable(db, game_id, coach)
    text = (body.get("text") or body.get("correction") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Correction text required")
    row = models.GameSessionReportCorrection(game_id=game_id, coach_id=coach.id, correction=text)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "correction": row.correction, "applied": row.applied}


@router.delete("/game-report-corrections/{correction_id}")
def delete_game_report_correction(
    correction_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    row = db.get(models.GameSessionReportCorrection, correction_id)
    if not row or row.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Correction not found")
    if row.applied:
        raise HTTPException(status_code=400, detail="Already applied — can't delete")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/sessions/{game_id}/apply-game-report-corrections")
async def apply_game_report_corrections(
    game_id: int,
    body: dict = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Regenerate the game report from the box score PLUS all of the coach's
    added context, then mark those corrections applied."""
    game = _get_game_readable(db, game_id, coach)
    if body:
        feedback = (body.get("feedback") or body.get("text") or "").strip()
        if feedback:
            db.add(models.GameSessionReportCorrection(game_id=game_id, coach_id=coach.id, correction=feedback))
            db.commit()
    pending = (
        db.query(models.GameSessionReportCorrection)
        .filter_by(game_id=game_id, coach_id=coach.id, applied=False)
        .order_by(models.GameSessionReportCorrection.id)
        .all()
    )
    all_corr = (
        db.query(models.GameSessionReportCorrection)
        .filter_by(game_id=game_id, coach_id=coach.id)
        .order_by(models.GameSessionReportCorrection.id)
        .all()
    )
    text = await _run_game_report(db, coach, game, [c.correction for c in all_corr])
    for p in pending:
        p.applied = True
    db.commit()
    return {"ai_game_report": text}


@router.get("/sessions/{game_id}/scouting-corrections")
def list_scouting_corrections(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    _get_game_readable(db, game_id, coach)
    rows = (
        db.query(models.GameScoutingCorrection)
        .filter_by(game_id=game_id, coach_id=coach.id)
        .order_by(models.GameScoutingCorrection.id)
        .all()
    )
    return [{"id": r.id, "correction": r.correction, "applied": r.applied, "created_at": r.created_at} for r in rows]


@router.post("/sessions/{game_id}/scouting-corrections")
def add_scouting_correction(
    game_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    _get_game_readable(db, game_id, coach)
    text = (body.get("text") or body.get("correction") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Correction text required")
    row = models.GameScoutingCorrection(game_id=game_id, coach_id=coach.id, correction=text)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "correction": row.correction, "applied": row.applied}


@router.patch("/scouting-corrections/{correction_id}")
def edit_scouting_correction(
    correction_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    row = db.get(models.GameScoutingCorrection, correction_id)
    if not row or row.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Correction not found")
    if row.applied:
        raise HTTPException(status_code=400, detail="Already applied — can't edit")
    text = (body.get("text") or body.get("correction") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Correction text required")
    row.correction = text
    db.commit()
    return {"id": row.id, "correction": row.correction, "applied": row.applied}


@router.delete("/scouting-corrections/{correction_id}")
def delete_scouting_correction(
    correction_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    row = db.get(models.GameScoutingCorrection, correction_id)
    if not row or row.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Correction not found")
    if row.applied:
        raise HTTPException(status_code=400, detail="Already applied — can't delete")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/sessions/{game_id}/apply-scouting-corrections")
async def apply_scouting_corrections(
    game_id: int,
    body: dict = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Regenerate the scouting report from the box score PLUS all of the coach's
    added context, then mark those corrections applied."""
    game = _get_game_readable(db, game_id, coach)
    if body:
        feedback = (body.get("feedback") or body.get("text") or "").strip()
        if feedback:
            db.add(models.GameScoutingCorrection(game_id=game_id, coach_id=coach.id, correction=feedback))
            db.commit()
    pending = (
        db.query(models.GameScoutingCorrection)
        .filter_by(game_id=game_id, coach_id=coach.id, applied=False)
        .order_by(models.GameScoutingCorrection.id)
        .all()
    )
    # Include ALL of the coach's context so the report reflects everything they've added.
    all_corr = (
        db.query(models.GameScoutingCorrection)
        .filter_by(game_id=game_id, coach_id=coach.id)
        .order_by(models.GameScoutingCorrection.id)
        .all()
    )
    text = await _run_scouting(db, coach, game, [c.correction for c in all_corr])
    for p in pending:
        p.applied = True
    db.commit()
    return {"ai_scouting_report": text}


# ── Season Dashboard ──────────────────────────────────────────────────────────

@router.get("/season-dashboard")
def season_dashboard(
    phases: str | None = None,   # comma-separated, e.g. "playoff,tournament"
    season_year: str | None = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    # Include games on teams the coach is linked to as staff, so a team's season
    # shows in the Team Grade dashboard for all its staff, not just the owner.
    from sqlalchemy import or_
    team_ids = _accessible_team_ids(db, coach)
    conds = [models.GameSession.coach_id == coach.id]
    if team_ids:
        conds.append(models.GameSession.team_id.in_(team_ids))
    q = db.query(models.GameSession).filter(or_(*conds)).filter(models.GameSession.status == "completed")
    if phases:
        phase_list = [p.strip() for p in phases.split(",") if p.strip()]
        if phase_list:
            q = q.filter(models.GameSession.season_phase.in_(phase_list))
    if season_year:
        q = q.filter(models.GameSession.season_year == season_year)
    games = q.order_by(models.GameSession.date).all()

    wins = 0
    losses = 0
    team_grade_trend = []
    player_totals: dict[str, dict] = {}

    for game in games:
        if game.our_score is not None and game.opponent_score is not None:
            if game.our_score > game.opponent_score:
                wins += 1
                win_loss_factor = 10.0
            elif abs(game.our_score - game.opponent_score) <= 5:
                losses += 1
                win_loss_factor = 7.0
            else:
                losses += 1
                win_loss_factor = 5.0
        else:
            win_loss_factor = 5.0

        our_stats = [s for s in game.player_stats if not s.is_opponent]
        mp_records = db.query(models.GameMinutesPlayed).filter_by(game_id=game.id, is_opponent=False).all()
        our_minutes = {r.player_name: r.minutes_played for r in mp_records}
        player_grades = _compute_grades(our_stats, our_minutes)

        if player_grades:
            avg_pg = sum(g["game_grade"] for g in player_grades) / len(player_grades)
        else:
            avg_pg = 0.0

        team_grade = round((avg_pg * 0.6) + (win_loss_factor * 0.4), 2)

        team_grade_trend.append({
            "game_id": game.id,
            "opponent": game.opponent_name,
            "date": game.date.isoformat() if game.date else None,
            "team_grade": team_grade,
            "our_score": game.our_score,
            "opponent_score": game.opponent_score,
        })

        for pg in player_grades:
            name = pg["player_name"]
            if name not in player_totals:
                player_totals[name] = {"games": 0, "total_grade": 0.0, "total_off": 0.0, "total_def": 0.0}
            player_totals[name]["games"] += 1
            player_totals[name]["total_grade"] += pg["game_grade"]
            player_totals[name]["total_off"] += pg["offensive_grade"]
            player_totals[name]["total_def"] += pg["defensive_grade"]

    player_leaderboard = []
    for name, data in player_totals.items():
        g = max(data["games"], 1)
        player_leaderboard.append({
            "player_name": name,
            "avg_game_grade": round(data["total_grade"] / g, 2),
            "games_played": data["games"],
            "avg_offensive": round(data["total_off"] / g, 2),
            "avg_defensive": round(data["total_def"] / g, 2),
        })
    player_leaderboard.sort(key=lambda x: x["avg_game_grade"], reverse=True)

    total_games = wins + losses
    win_pct = round(wins / total_games, 3) if total_games > 0 else 0.0
    season_avg = round(
        sum(t["team_grade"] for t in team_grade_trend) / len(team_grade_trend), 2
    ) if team_grade_trend else 0.0

    # Phase breakdown
    all_games = db.query(models.GameSession).filter_by(coach_id=coach.id).all()
    phases = list({g.season_phase for g in all_games if g.season_phase})

    return {
        "record": {"wins": wins, "losses": losses, "win_pct": win_pct},
        "team_grade_trend": team_grade_trend,
        "player_leaderboard": player_leaderboard,
        "season_avg_team_grade": season_avg,
        "phases_available": phases,
    }


# ── Opponent Profile ──────────────────────────────────────────────────────────

@router.get("/opponents/{opponent_name}")
def opponent_profile(
    opponent_name: str,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    # Opponent intel is built from every game against them that the coach can
    # see — their own games plus games on teams they're staff on.
    from sqlalchemy import or_
    team_ids = _accessible_team_ids(db, coach)
    conds = [models.GameSession.coach_id == coach.id]
    if team_ids:
        conds.append(models.GameSession.team_id.in_(team_ids))
    games = (
        db.query(models.GameSession)
        .filter(or_(*conds), models.GameSession.opponent_name == opponent_name)
        .order_by(models.GameSession.date.desc())
        .all()
    )
    if not games:
        raise HTTPException(status_code=404, detail="No games found for this opponent")

    player_totals: dict[str, dict] = {}
    offense_tendencies: dict[str, int] = defaultdict(int)
    defense_tendencies: dict[str, int] = defaultdict(int)
    latest_report = None

    for game in games:
        # The coach's own scouting report for that game (not another coach's).
        own_scout = _coach_scouting(db, coach, game)
        if own_scout:
            latest_report = own_scout
        opp_stats = [s for s in game.player_stats if s.is_opponent]
        for s in opp_stats:
            if s.player_name not in player_totals:
                player_totals[s.player_name] = {"games": 0, "total_grade": 0.0}
            player_totals[s.player_name]["total_grade"] += s.weighted_points
            if s.stat_category == "offense":
                offense_tendencies[s.stat_name] += s.count
            else:
                defense_tendencies[s.stat_name] += s.count
        # update game count per player
        seen = set()
        for s in opp_stats:
            if s.player_name not in seen:
                player_totals[s.player_name]["games"] = player_totals[s.player_name].get("games", 0) + 1
                seen.add(s.player_name)

    best_players = sorted(
        [{"player_name": n, "avg_grade": round(d["total_grade"] / max(d["games"], 1), 2), "games": d["games"]}
         for n, d in player_totals.items()],
        key=lambda x: x["avg_grade"],
        reverse=True,
    )[:5]

    top_offense = sorted(offense_tendencies.items(), key=lambda x: x[1], reverse=True)[:3]
    top_defense = sorted(defense_tendencies.items(), key=lambda x: x[1], reverse=True)[:3]

    # Weak spots: lowest-scoring offense/defense stats
    all_stat_scores: dict[str, float] = defaultdict(float)
    for game in games:
        for s in game.player_stats:
            if s.is_opponent:
                all_stat_scores[s.stat_name] += s.weighted_points
    weak_spots = sorted(all_stat_scores.items(), key=lambda x: x[1])[:3]

    games_list = [
        {"id": g.id, "date": g.date.isoformat() if g.date else None,
         "our_score": g.our_score, "opponent_score": g.opponent_score, "status": g.status}
        for g in games
    ]

    return {
        "opponent_name": opponent_name,
        "games_played_against": games_list,
        "best_players": best_players,
        "offensive_tendencies": [{"stat": s, "count": c} for s, c in top_offense],
        "defensive_tendencies": [{"stat": s, "count": c} for s, c in top_defense],
        "weak_spots": [{"stat": s, "score": round(sc, 2)} for s, sc in weak_spots],
        "ai_scouting_report": latest_report,
    }


# ── Opponent Notes ────────────────────────────────────────────────────────────

@router.get("/opponents/{opponent_name}/notes")
def get_opponent_notes(
    opponent_name: str,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    notes = (
        db.query(models.OpponentNote)
        .filter_by(coach_id=coach.id, opponent_name=opponent_name)
        .order_by(models.OpponentNote.created_at)
        .all()
    )
    return [{"id": n.id, "note_text": n.note_text, "created_at": n.created_at.isoformat()} for n in notes]


@router.post("/opponents/{opponent_name}/notes")
def add_opponent_note(
    opponent_name: str,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    note = models.OpponentNote(
        coach_id=coach.id,
        opponent_name=opponent_name,
        note_text=body.get("note_text", "").strip(),
    )
    if not note.note_text:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="note_text required")
    db.add(note)
    db.commit()
    db.refresh(note)
    return {"id": note.id, "note_text": note.note_text, "created_at": note.created_at.isoformat()}


@router.delete("/opponent-notes/{note_id}")
def delete_opponent_note(
    note_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    note = db.get(models.OpponentNote, note_id)
    if not note or note.coach_id != coach.id:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
    return {"ok": True}


# ── Opponent Roster (saved opponent players, persisted by opponent name) ──────

def _opp_player_out(p: models.OpponentPlayer) -> dict:
    return {
        "id": p.id,
        "opponent_name": p.opponent_name,
        "player_name": p.player_name,
        "jersey_number": p.jersey_number,
        "position": p.position,
    }


@router.get("/opponents/{opponent_name}/players")
def list_opponent_players(
    opponent_name: str,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    players = (
        db.query(models.OpponentPlayer)
        .filter_by(coach_id=coach.id, opponent_name=opponent_name)
        .order_by(models.OpponentPlayer.id)
        .all()
    )
    return [_opp_player_out(p) for p in players]


@router.post("/opponents/{opponent_name}/players")
def add_opponent_player(
    opponent_name: str,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    name = (body.get("player_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="player_name required")
    # Avoid duplicates for the same opponent
    existing = (
        db.query(models.OpponentPlayer)
        .filter_by(coach_id=coach.id, opponent_name=opponent_name, player_name=name)
        .first()
    )
    if existing:
        existing.jersey_number = (body.get("jersey_number") or "").strip() or existing.jersey_number
        existing.position = (body.get("position") or "").strip() or existing.position
        db.commit()
        db.refresh(existing)
        return _opp_player_out(existing)
    player = models.OpponentPlayer(
        coach_id=coach.id,
        opponent_name=opponent_name,
        player_name=name,
        jersey_number=(body.get("jersey_number") or "").strip() or None,
        position=(body.get("position") or "").strip() or None,
    )
    db.add(player)
    db.commit()
    db.refresh(player)
    return _opp_player_out(player)


@router.delete("/opponent-players/{player_id}")
def delete_opponent_player(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    p = db.get(models.OpponentPlayer, player_id)
    if not p or p.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Opponent player not found")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ── Compare Games ─────────────────────────────────────────────────────────────

@router.get("/compare")
def compare_games(
    game1_id: int,
    game2_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game1 = _get_game(db, game1_id, coach.id)
    game2 = _get_game(db, game2_id, coach.id)

    def _summarize(game: models.GameSession) -> dict:
        our_stats = [s for s in game.player_stats if not s.is_opponent]
        mp_records = db.query(models.GameMinutesPlayed).filter_by(game_id=game.id, is_opponent=False).all()
        minutes = {r.player_name: r.minutes_played for r in mp_records}
        grades = _compute_grades(our_stats, minutes)
        avg_pg = sum(g["game_grade"] for g in grades) / len(grades) if grades else 0.0
        if game.our_score is not None and game.opponent_score is not None:
            wlf = 10.0 if game.our_score > game.opponent_score else (7.0 if abs(game.our_score - game.opponent_score) <= 5 else 5.0)
        else:
            wlf = 5.0
        team_grade = round(avg_pg * 0.6 + wlf * 0.4, 2)
        return {
            "game_id": game.id,
            "opponent": game.opponent_name,
            "date": game.date.isoformat() if game.date else None,
            "our_score": game.our_score,
            "opponent_score": game.opponent_score,
            "team_grade": team_grade,
            "player_grades": grades,
        }

    return {
        "game1": _summarize(game1),
        "game2": _summarize(game2),
    }


# ── Whiteboards ───────────────────────────────────────────────────────────────

@router.get("/sessions/{game_id}/whiteboards")
def list_whiteboards(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    _get_game(db, game_id, coach.id)
    boards = db.query(models.GameWhiteboard).filter_by(game_id=game_id, coach_id=coach.id).order_by(models.GameWhiteboard.created_at).all()
    return [{"id": b.id, "name": b.name, "court_type": b.court_type, "data": b.data, "created_at": b.created_at.isoformat()} for b in boards]


# Coach-level PLAYBOOK boards — not tied to any game, so plays the coach draws
# persist in "my boards" until deleted, regardless of games.
#
# NULL, not a 0 sentinel. game_id is a foreign key to game_sessions and no
# session has id 0: SQLite does not enforce foreign keys by default so this
# saved locally, while the deployed Postgres rejected every playbook write with
# a constraint violation surfacing as a 500. Rows written under the old sentinel
# are still read below so nothing drawn before this is lost.
_PLAYBOOK_GID = None
_LEGACY_PLAYBOOK_GID = 0


def _playbook_filter():
    """Match a coach's playbook boards, written under either convention."""
    from sqlalchemy import or_
    return or_(models.GameWhiteboard.game_id.is_(None),
               models.GameWhiteboard.game_id == _LEGACY_PLAYBOOK_GID)


@router.get("/playbook/whiteboards")
def list_playbook(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    boards = (
        db.query(models.GameWhiteboard)
        .filter(_playbook_filter(), models.GameWhiteboard.coach_id == coach.id)
        .order_by(models.GameWhiteboard.created_at)
        .all()
    )
    return [{"id": b.id, "name": b.name, "court_type": b.court_type, "data": b.data, "created_at": b.created_at.isoformat()} for b in boards]


@router.post("/playbook/whiteboards")
def create_playbook(
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    board = models.GameWhiteboard(
        game_id=_PLAYBOOK_GID,
        coach_id=coach.id,
        name=body.get("name", "Untitled Board"),
        court_type=body.get("court_type", "full"),
        data=body.get("data", "[]"),
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    return {"id": board.id, "name": board.name, "court_type": board.court_type, "data": board.data, "created_at": board.created_at.isoformat()}


@router.post("/sessions/{game_id}/whiteboards")
def create_whiteboard(
    game_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    _get_game(db, game_id, coach.id)
    board = models.GameWhiteboard(
        game_id=game_id,
        coach_id=coach.id,
        name=body.get("name", "Untitled Board"),
        court_type=body.get("court_type", "full"),
        data=body.get("data", "[]"),
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    return {"id": board.id, "name": board.name, "court_type": board.court_type, "data": board.data, "created_at": board.created_at.isoformat()}


@router.patch("/whiteboards/{board_id}")
def update_whiteboard(
    board_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    board = db.get(models.GameWhiteboard, board_id)
    if not board or board.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Whiteboard not found")
    if "name" in body:
        board.name = body["name"]
    if "court_type" in body:
        board.court_type = body["court_type"]
    if "data" in body:
        board.data = body["data"]
    board.updated_at = datetime.utcnow()
    db.commit()
    return {"id": board.id, "name": board.name, "court_type": board.court_type, "data": board.data}


# ── AI play validation (shared by draw-up / describe / adapt) ────────────────
def _pt(v, lo, hi, d):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return d


def _clean_scheme(sc):
    sc = sc if isinstance(sc, dict) else {}
    out = {"players": [], "defenders": [], "actions": []}
    for i, pl in enumerate((sc.get("players") or [])[:5]):
        out["players"].append({"id": str(pl.get("id") or f"O{i+1}")[:3],
                               "x": _pt(pl.get("x"), -2, 52, 25), "y": _pt(pl.get("y"), 48, 96, 80),
                               "role": str(pl.get("role") or "")[:200]})
    for i, df in enumerate((sc.get("defenders") or [])[:5]):
        out["defenders"].append({"id": str(df.get("id") or f"X{i+1}")[:3],
                                 "x": _pt(df.get("x"), -2, 52, 25), "y": _pt(df.get("y"), 48, 96, 74),
                                 "role": str(df.get("role") or "")[:200]})

    # Auto-correct obviously-wrong on-ball defenders: a PERIMETER defender
    # (guarding a man up top, man.y < 76) that sits ON TOP of / above its man
    # (farther from the basket) is almost never right — nudge it to the basket
    # side (between man and rim). Post fronts / off-ball are left untouched.
    by_num = {p["id"][1:]: p for p in out["players"] if len(p["id"]) > 1}
    for df in out["defenders"]:
        man = by_num.get(df["id"][1:]) if len(df["id"]) > 1 else None
        if not man:
            continue
        perimeter = man["y"] < 76
        guarding = abs(df["x"] - man["x"]) < 10
        non_basket_side = df["y"] <= man["y"] + 1  # at/above man = away from rim
        if perimeter and guarding and non_basket_side:
            df["y"] = min(man["y"] + 5.0, 90.0)
            df["x"] = man["x"] + (25.0 - man["x"]) * 0.12  # ease slightly toward the middle
    for idx, a in enumerate((sc.get("actions") or [])[:10]):
        fr, to = a.get("from") or [25, 80], a.get("to") or [25, 70]
        try:
            step = max(1, int(a.get("step") or (idx + 1)))
        except (TypeError, ValueError):
            step = idx + 1
        out["actions"].append({"kind": str(a.get("kind") or "cut"), "step": step,
                               "actor": str(a.get("actor") or "")[:3],
                               "from": [_pt(fr[0], -2, 52, 25), _pt(fr[1], 48, 96, 80)],
                               "to":   [_pt(to[0], -2, 52, 25), _pt(to[1], 48, 96, 70)]})
    return out


def _clean_key(raw_key):
    out = []
    for i, k in enumerate((raw_key or [])[:5]):
        fr, to = (k.get("from") or [25, 80]), (k.get("to") or [25, 70])
        out.append({"n": int(k.get("n") or i + 1),
                    "text": str(k.get("text") or "")[:120],
                    "from": [_pt(fr[0], -2, 52, 25), _pt(fr[1], 48, 96, 80)],
                    "to":   [_pt(to[0], -2, 52, 25), _pt(to[1], 48, 96, 70)]})
    return out


# ── AI play draw-up ───────────────────────────────────────────────────────────
# Turns a coach's description of a scene/play into a structured X's-and-O's
# diagram: offense / defense / counter schemes plus a numbered improvement key.
_AI_PLAY_PROMPT = """You are an elite basketball tactician. From the scene description below, produce a schematic play diagram as STRICT JSON (no markdown, no prose).

POSITIONS: the player numbers are basketball positions — 1 = Point Guard (O1), 2 = Shooting Guard (O2), 3 = Small Forward (O3), 4 = Power Forward (O4), 5 = Center (O5). Place and move each player consistent with their position (e.g. O1 initiates up top, O5 plays around the rim/high post), and each defender X1-X5 guards the matching position (X5 guards O5, etc.).

COORDINATES: feet on a regulation HALF court. x: 0 = left sideline, 25 = middle, 50 = right sideline. y grows toward the hoop — LOW y is farther from the basket (up top), HIGH y is at the rim. The x,y for every player and defender is their STARTING position, before the play develops (movement is expressed only through actions).

DEFENDER POSITIONING: by default place each defender on the BASKET side of the player they guard — between their man and the rim. Because the rim is at HIGH y, that means the defender sits at a slightly HIGHER y than their man (about 3-5 ft toward the basket), roughly on the line from their man to the rim. So the on-ball defender of a point guard up top (y≈62) belongs just below him toward the basket (y≈66-67), NOT above him. Only put a defender on the non-basket (ball/deny) side when the scene or scheme calls for fronting the post, denying a wing, or top-locking a shooter. Landmarks: half-court line y=47, top of the 3-point arc / where the point guard initiates y≈62, free-throw line y=75, elbows y≈75 (x≈17 and x≈33), rim/basket y≈89, blocks/low post y≈84 (x≈19 and x≈31), wings y≈66 (x≈8 and x≈42), corners y≈90 (x≈4 and x≈46). The ball-handler up top belongs around y=60-64, NOT at the free-throw line. Keep in-bounds coordinates inside 2..48 for x and 48..92 for y.

INBOUND PLAYS (BLOB / SLOB): the court now shows a little out-of-bounds floor beyond the lines. If the scene is an inbound play, place the player taking the ball out (the inbounder) OUT OF BOUNDS and start the inbound pass from there: for a baseline out-of-bounds (BLOB) inbounder use y≈95 (just past the baseline) at the x you want along the endline; for a sideline out-of-bounds (SLOB) inbounder use x≈-1 (left) or x≈51 (right) at the y you want. Only use these out-of-bounds spots for an actual inbounder on an inbound play; everyone else stays in bounds.

Return exactly this shape. Output play_name and the FULL key array FIRST, then the schemes last — the key must never be omitted:
{
  "play_name": "short name",
  "key": [{"n": 1, "text": "concise coaching suggestion", "from": [x, y], "to": [x, y]}],
  "schemes": {
    "offense": {"players": [{"id": "O1", "x": 25, "y": 80, "role": "what O1 does in this scheme"}], "defenders": [{"id": "X1", "x": 25, "y": 76, "role": "what X1 does in this scheme"}], "actions": [{"actor": "O2", "kind": "cut|screen|pass|dribble", "from": [25, 80], "to": [30, 70], "step": 1}]},
    "defense": { same shape },
    "counter": { same shape }
  }
}

ACTOR: every action has an "actor" = the id of the player or defender who makes that movement (must match one of the players/defenders ids, e.g. "O2" or "X1"). The action's "from" should be that actor's current position and "to" is where they move. For a "pass", the actor is the passer and "from"/"to" are the ball's path (no one relocates on a pass).

STEPS: every action has a "step" integer (1,2,3,...) marking WHEN it happens as the play develops. Actions that happen at the SAME time share the same step number; actions that happen later get higher step numbers. Order the play realistically (e.g. screen on step 1, cut on step 2, pass on step 3).

ROLE: for EVERY player (O1-O5) AND defender (X1-X5) in EVERY scheme, include a short "role" string (under 120 characters) describing what that player does in that scheme — their action, assignment, or spot. Reflect the scene description and any BY-PLAYER INSTRUCTIONS so the coach can see how you read their words for each player.

BY-PLAYER INSTRUCTIONS: the scene may list per-player intent as O1-O5 (offense) and D1-D5 (defense). D1-D5 are the defenders X1-X5 (D1 = X1 guards O1, D2 = X2 guards O2, and so on). Assign each player/defender to do exactly what its note says, and reflect it in that player's role and movements.

STANDING PER-PLAYER INSTRUCTIONS: if the scene lists these, ALWAYS honor them — you may reword them for clarity but never drop the coach's intent, and reflect each one in that player's role and movements.

LABELS: in the human-facing "text" of every key item, refer to defenders as D1-D5, never X1-X5 (the JSON ids stay X1-X5, but the key text the coach reads must say D1-D5).

CONSTRAINTS: if the scene lists LOCKED PLAYERS or PER-PLAYER GUIDANCE / PLAYER ADJUSTMENTS, honor them precisely — keep any locked player at the exact coordinates given and reposition (cascade) only the other players to make the play work, and follow each per-player note.

SCHEME CONSISTENCY (important): the three schemes are LAYERS of ONE play, not three separate plays. By default OFFENSE is the base:
- OFFENSE = the base offensive play: the offensive players (O1-O5) and their movement.
- DEFENSE = the EXACT same offensive players, at the EXACT same starting positions, with the EXACT same offensive actions as OFFENSE (identical — do not change them), PLUS the defenders (X1-X5) and their reactions/rotations. (So the coach sees the offense the defense is reacting to.)
- COUNTER = the SAME offensive starting positions and the SAME early actions as OFFENSE, but it DIVERGES near the end into a different finish/read (the alternate outcome). Keep the beginning identical; only the last step(s) differ.
If the scene is a DEFENSE-FIRST request (the coach is drawing up a defense, e.g. "show a 2-3 zone", "how do we guard this"), then DEFENSE is the base instead, and OFFENSE/COUNTER layer onto that same defensive alignment.

DEFENSIVE MOVEMENT (defense scheme) — the defenders must ACTIVELY MOVE to stop a basket, never stand still. Give the BEST realistic defense against the offense's actions: the on-ball defender slides and mirrors the ball-handler; every off-ball defender MOVES WITH their man and stays between their man and the rim; on a ball screen pick a coverage (hedge, switch, drop, or blitz) and move the defenders to execute it; help off the weakest shooter to wall up drives and TAG the roller, then recover/close out; deny the primary scoring option; contest the shot at the rim. Add a stepped defensive action for EVERY defender who must move to prevent the score, timed (same step) to the offensive action they are reacting to.

RULES: 5 offensive players (O1-O5) and up to 5 defenders (X1-X5) per scheme; at most 10 actions per scheme; 3-5 key items. The key holds the suggested movements or positioning that would have made the play succeed (get a basket, find the open man, correct the rotation) — each key arrow shows the improved movement. Keep key text under 90 characters.

OUTPUT ONLY the JSON object. It MUST be strictly valid: every array element and object property separated by a comma, no trailing commas, no comments, no prose before or after."""


def _parse_ai_play_json(raw: str):
    """Best-effort parse of the model's JSON, repairing common LLM mistakes."""
    import re as _re
    import json as _json
    raw = _re.sub(r"^```(?:json)?|```$", "", raw, flags=_re.MULTILINE).strip()
    m = _re.search(r"\{.*\}", raw, _re.DOTALL)
    candidate = m.group(0) if m else raw
    try:
        return _json.loads(candidate)
    except Exception:
        pass
    # Repair: strip trailing commas before } or ]
    repaired = _re.sub(r",\s*([}\]])", r"\1", candidate)
    # Repair: insert missing commas between adjacent tokens across a newline.
    repaired = _re.sub(r"([}\]0-9\"])\s*\n\s*([{\[\"])", r"\1,\n\2", repaired)
    # Repair: missing comma between a value and the next object/array on the SAME
    # line (e.g. "} {" or "] [" or "5 {") — common when the model omits a comma.
    repaired = _re.sub(r"([}\]0-9])\s+([{\[])", r"\1,\2", repaired)
    return _json.loads(repaired)


@router.post("/ai-play")
async def ai_play(
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    description = (body.get("description") or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="Describe the scene or play first")
    # Fold any newly-drawn boards into the coach's style profile, then bias the
    # generation toward how this coach positions players.
    style_block = ""
    try:
        from ..play_style import refresh_and_get_profile
        profile = refresh_and_get_profile(db, coach)
        if profile and profile.strip():
            style_block = (
                "\n\nCOACH STYLE — how THIS coach positions players and what they favor. Bias the play "
                "toward this (especially when the scene is brief), unless the scene says otherwise:\n"
                f"{profile.strip()}\n"
            )
    except Exception:
        style_block = ""
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        resp = await client.messages.create(
            model=OPUS,
            max_tokens=8000,
            messages=[{"role": "user", "content": f"{_AI_PLAY_PROMPT}{style_block}\n\nSCENE:\n{description}"}],
        )
        blocks = [b for b in resp.content if hasattr(b, "text")]
        raw = (blocks[0].text if blocks else "{}").strip()
        try:
            data = _parse_ai_play_json(raw)
        except Exception:
            # One retry: ask the model to return corrected, strictly-valid JSON.
            fix = await client.messages.create(
                model=OPUS,
                max_tokens=8000,
                messages=[{"role": "user", "content":
                    "The following was supposed to be strict JSON but is invalid. "
                    "Return ONLY the corrected, strictly-valid JSON — same data, no prose, "
                    f"no trailing commas, no comments:\n\n{raw}"}],
            )
            fblocks = [b for b in fix.content if hasattr(b, "text")]
            data = _parse_ai_play_json(fblocks[0].text if fblocks else "{}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI play generation failed: {exc}")

    # Validate + clamp everything the client will render (helpers at module level).
    schemes = data.get("schemes") if isinstance(data.get("schemes"), dict) else {}
    key_items = _clean_key(data.get("key"))

    # Guarantee the key: if it came back empty, generate it in a separate,
    # small call so a long play can never leave the suggestions blank.
    if not key_items:
        try:
            import json as _json2
            kresp = await client.messages.create(
                model=OPUS,
                max_tokens=2000,
                messages=[{"role": "user", "content":
                    "For the basketball play below, list 3-5 KEY suggested improvements — the movements or "
                    "positioning that would have made it succeed (get a basket, find the open man, correct the "
                    "rotation). Return ONLY strict JSON: {\"key\": [{\"n\":1, \"text\":\"...\", \"from\":[x,y], "
                    "\"to\":[x,y]}]}. Coordinates are half-court feet (x 2..48, y 48..92, high y = rim). Key text "
                    f"under 90 chars.\n\nPLAY:\n{description}"}],
            )
            kb = [b for b in kresp.content if hasattr(b, "text")]
            kdata = _parse_ai_play_json(kb[0].text if kb else "{}")
            key_items = _clean_key(kdata.get("key"))
        except Exception:
            pass

    return {
        "play_name": str(data.get("play_name") or "AI Play")[:40],
        "schemes": {name: _clean_scheme(schemes.get(name)) for name in ("offense", "defense", "counter")},
        "key": key_items,
    }


# ── Re-describe after a manual player drag ────────────────────────────────────
# The coach dragged one player to a new spot. Keep everyone else exactly where
# they are; rewrite just the moved player's role and refresh the key.
@router.post("/ai-play-describe")
async def ai_play_describe(
    body: dict,
    coach: models.Coach = Depends(get_current_coach),
):
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    schemes = body.get("schemes") if isinstance(body.get("schemes"), dict) else {}
    scheme = str(body.get("scheme") or "offense")
    pid = str(body.get("player_id") or "")
    source = str(body.get("source") or "")[:2000]
    scm = schemes.get(scheme) or {}
    units = list(scm.get("players") or []) + list(scm.get("defenders") or [])
    moved = next((u for u in units if str(u.get("id")) == pid), None)
    if not moved:
        raise HTTPException(status_code=400, detail="Moved player not found in that scheme")

    def _disp(i):
        i = str(i or "")
        return ("D" + i[1:]) if i[:1] == "X" else i

    disp = _disp(pid)

    def _fmt(s):
        us = list(s.get("players") or []) + list(s.get("defenders") or [])
        return "\n".join(
            f"- {_disp(u.get('id'))} at x={round(float(u.get('x', 25)))}, y={round(float(u.get('y', 80)))}: {str(u.get('role') or '')[:120]}"
            for u in us
        )

    prompt = (
        "You are an elite basketball tactician. COORDINATES: half-court feet, x 0=left sideline / 50=right, "
        "y grows toward the rim (low y = up top, high y = at the basket; y>94 is out of bounds behind the baseline).\n\n"
        f"ORIGINAL PLAY: {source or '(none given)'}\n\n"
        f"CURRENT {scheme.upper()} FORMATION (everyone stays here — do NOT move anyone):\n{_fmt(scm)}\n\n"
        f"The coach just MANUALLY MOVED {disp} to x={round(float(moved.get('x', 25)))}, y={round(float(moved.get('y', 80)))}. "
        f"Rewrite ONLY what {disp} does from this new spot, consistent with the rest of the formation. "
        "Return STRICT JSON only, no prose: {\"role\": \"<one concise sentence under 120 chars>\", "
        "\"key\": [{\"n\": 1, \"text\": \"<refreshed coaching point under 90 chars, refer to defenders as D1-D5>\"}]}. "
        "Give 3-4 key items."
    )
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        resp = await client.messages.create(
            model=OPUS, max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        blocks = [b for b in resp.content if hasattr(b, "text")]
        data = _parse_ai_play_json(blocks[0].text if blocks else "{}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Re-describe failed: {exc}")

    role = str(data.get("role") or moved.get("role") or "")[:200]
    key = []
    for i, k in enumerate((data.get("key") or [])[:5]):
        key.append({"n": int(k.get("n") or i + 1), "text": str(k.get("text") or "")[:120]})
    return {"role": role, "key": key}


# ── Adapt a play around the coach's manual moves ──────────────────────────────
# The coach edited ONE scheme (moved players/arrows). Keep that scheme's starting
# positions locked and its movement minimally changed; then cascade the change to
# the DEPENDENT schemes (defense reacts to offense, counter adjusts to defense)
# and refresh the key, so the whole play stays consistent.
@router.post("/ai-play-adapt")
async def ai_play_adapt(
    body: dict,
    coach: models.Coach = Depends(get_current_coach),
):
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    # Back-compat: accept old single-scheme shape too.
    edited = str(body.get("edited") or body.get("scheme_name") or "offense")
    schemes = body.get("schemes") if isinstance(body.get("schemes"), dict) else {}
    if not schemes and isinstance(body.get("scheme"), dict):
        schemes = {edited: body["scheme"]}
    downstream = [s for s in (body.get("downstream") or []) if s in ("offense", "defense", "counter") and s != edited]
    key = body.get("key") if isinstance(body.get("key"), list) else []
    locked = body.get("locked") if isinstance(body.get("locked"), dict) else {}
    source = str(body.get("source") or "")[:2000]

    def _disp(i):
        i = str(i or "")
        return ("D" + i[1:]) if i[:1] == "X" else i

    def _pt2(pt):
        try:
            return f"({round(float(pt[0]))},{round(float(pt[1]))})"
        except Exception:
            return "(?,?)"

    def _fmt_scheme(name):
        sc = schemes.get(name) or {}
        units = "\n".join(
            f"    - {_disp(u.get('id'))} at ({round(float(u.get('x', 25)))},{round(float(u.get('y', 80)))}): {str(u.get('role') or '')[:90]}"
            for u in (list(sc.get("players") or []) + list(sc.get("defenders") or []))
        )
        acts = "\n".join(
            f"    - {_disp(a.get('actor'))} {a.get('kind')} {_pt2(a.get('from') or [0, 0])}->{_pt2(a.get('to') or [0, 0])} (step {a.get('step', 1)})"
            for a in (sc.get("actions") or [])
        )
        return f"  {name.upper()}:\n   players/defenders:\n{units or '    (none)'}\n   actions:\n{acts or '    (none)'}"

    all_txt = "\n\n".join(_fmt_scheme(n) for n in ("offense", "defense", "counter") if schemes.get(n))
    locked_units = ", ".join(f"{_disp(u.get('id'))}@{_pt2([u.get('x'), u.get('y')])}" for u in (locked.get("units") or [])) or "none"
    locked_actions = "; ".join(
        f"{_disp(a.get('actor'))} {a.get('kind')} {_pt2(a.get('from') or [0, 0])}->{_pt2(a.get('to') or [0, 0])}"
        for a in (locked.get("actions") or [])
    ) or "none"
    locked_keys = "; ".join(_pt2(k.get("from") or [0, 0]) + "->" + _pt2(k.get("to") or [0, 0]) for k in (locked.get("keys") or [])) or "none"
    dep_list = ", ".join(s.upper() for s in downstream) or "none"
    return_names = [edited] + downstream

    prompt = (
        "You are an elite basketball tactician. A play has three schemes — OFFENSE (what the offense runs), "
        "DEFENSE (the defensive scheme guarding it), COUNTER (the adjustment) — plus a KEY of suggested "
        "improvements. COORDINATES: half-court feet, x 0=left/50=right, y grows toward the rim (low y = up "
        "top, high y = at the basket; y>94 = out of bounds behind the baseline for inbounds).\n\n"
        f"ORIGINAL PLAY: {source or '(none given)'}\n\n"
        f"THE FULL PLAY NOW:\n{all_txt}\n\n"
        f"The coach just edited the {edited.upper()} scheme. Pieces the coach placed there (keep EXACTLY):\n"
        f"  players/defenders: {locked_units}\n  action arrows: {locked_actions}\n  key arrows: {locked_keys}\n\n"
        f"Do this:\n"
        f"1) EDITED scheme ({edited.upper()}) — MAKE THE SMALLEST CHANGE: keep EVERY player/defender at its "
        f"EXACT position (never move a starting spot), keep the existing action arrows, only adjust an arrow "
        f"if the coach's change broke it, and update role text.\n"
        f"2) DEPENDENT schemes ({dep_list}) — UPDATE these so they stay consistent with the edited "
        f"{edited.upper()}. If DEFENSE is dependent: keep the EXACT same offensive players, positions, and "
        f"offensive actions as the edited offense (identical), then give the defenders the BEST realistic "
        f"reaction to STOP a basket — the on-ball defender mirrors the ball, off-ball defenders move WITH "
        f"their man between man and rim, help/tag the roller on drives and screens, deny the primary "
        f"option, contest the shot — with a stepped defensive action for every defender who must move. If "
        f"COUNTER is dependent: keep the same offensive start and early actions, diverge only at the end. "
        f"Reposition/redraw within those rules.\n"
        f"3) Refresh the KEY to match the updated play.\n"
        f"Keep the same player/defender ids everywhere.\n\n"
        "Return STRICT JSON only, no prose. Include ONLY these schemes: "
        + ", ".join(f'"{n}"' for n in return_names) + ".\n"
        '{"schemes": {"' + edited + '": {"players": [{"id":"O1","x":25,"y":62,"role":"..."}], '
        '"defenders": [{"id":"X1","x":25,"y":66,"role":"..."}], '
        '"actions": [{"actor":"O2","kind":"cut|screen|pass|dribble","from":[x,y],"to":[x,y],"step":1}]}}, '
        '"key": [{"n":1,"text":"<under 90 chars, refer to defenders as D1-D5>","from":[x,y],"to":[x,y]}]}. '
        "Give 3-5 key items. Defender ids stay X1-X5 in JSON."
    )
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        resp = await client.messages.create(
            model=OPUS, max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
        )
        blocks = [b for b in resp.content if hasattr(b, "text")]
        raw = (blocks[0].text if blocks else "{}").strip()
        try:
            data = _parse_ai_play_json(raw)
        except Exception:
            # One retry: ask the model to return corrected, strictly-valid JSON.
            fix = await client.messages.create(
                model=OPUS, max_tokens=4000,
                messages=[{"role": "user", "content":
                    "The following was supposed to be strict JSON but is invalid. Return ONLY the "
                    "corrected, strictly-valid JSON — same data, no prose, no trailing commas, no "
                    f"comments, every element comma-separated:\n\n{raw}"}],
            )
            fblocks = [b for b in fix.content if hasattr(b, "text")]
            data = _parse_ai_play_json(fblocks[0].text if fblocks else "{}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Adapt failed: {exc}")

    out_schemes = {}
    raw_schemes = data.get("schemes") if isinstance(data.get("schemes"), dict) else {}
    # Back-compat: a bare "scheme" applies to the edited scheme.
    if not raw_schemes and isinstance(data.get("scheme"), dict):
        raw_schemes = {edited: data["scheme"]}
    for name in return_names:
        if isinstance(raw_schemes.get(name), dict):
            out_schemes[name] = _clean_scheme(raw_schemes[name])
    out_key = _clean_key(data.get("key"))
    return {"schemes": out_schemes, "key": out_key}


# ── Review + name a hand-drawn (freehand) play ────────────────────────────────
# The coach played back a freehand drawing (players + ordered move/pass arrows).
# Return a short play NAME and a 1-2 sentence read of what happens, in order.
@router.post("/ai-play-name")
async def ai_play_name(
    body: dict,
    coach: models.Coach = Depends(get_current_coach),
):
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    markers = body.get("markers") if isinstance(body.get("markers"), list) else []
    arrows = body.get("arrows") if isinstance(body.get("arrows"), list) else []
    labels = [str(x)[:40] for x in (body.get("labels") or []) if x][:12]

    def _pt2(pt):
        try:
            return f"({round(float(pt[0]))},{round(float(pt[1]))})"
        except Exception:
            return "(?,?)"

    mk_txt = ", ".join(f"{('O' if m.get('kind') == 'O' else 'X')}@{_pt2([m.get('x'), m.get('y')])}" for m in markers[:12]) or "none marked"
    ar_txt = "\n".join(
        f"  {i+1}. step {a.get('step', i+1)}: {a.get('kind', 'move')} {_pt2(a.get('from') or [0, 0])} -> {_pt2(a.get('to') or [0, 0])}"
        for i, a in enumerate(sorted(arrows, key=lambda a: a.get('step', 0))[:20])
    ) or "  (no movement)"
    prompt = (
        "A basketball coach hand-drew a play on a half court (feet: x 0=left/50=right, y grows toward the "
        "rim). Players/defenders (O = offense, X = defense) are at these spots:\n"
        f"{mk_txt}\n\n"
        f"The movements, IN ORDER (move = a player cut/drive, pass = a pass):\n{ar_txt}\n"
        + (f"\nLabels the coach wrote: {', '.join(labels)}\n" if labels else "")
        + "\nReturn STRICT JSON only: {\"name\": \"<short play name, under 40 chars>\", "
        "\"read\": \"<1-2 sentences describing what happens, in order>\"}. No prose."
    )
    import anthropic
    import sys
    client = anthropic.AsyncAnthropic()
    data: dict = {}
    raw = ""
    try:
        resp = await client.messages.create(
            model=OPUS, max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        blocks = [b for b in resp.content if hasattr(b, "text")]
        raw = (blocks[0].text if blocks else "{}").strip()
        data = _parse_ai_play_json(raw)
    except Exception:
        # One retry: ask for corrected strict JSON.
        try:
            fix = await client.messages.create(
                model=OPUS, max_tokens=2000,
                messages=[{"role": "user", "content":
                    "Return ONLY strict JSON of the form {\"name\":\"...\",\"read\":\"...\"} for this play "
                    "text — no prose, no markdown:\n\n" + (raw or prompt)}],
            )
            fb = [b for b in fix.content if hasattr(b, "text")]
            data = _parse_ai_play_json(fb[0].text if fb else "{}")
        except Exception as exc:
            # Auto-naming is best-effort — never 500; the client just skips naming.
            print(f"ai-play-name: naming skipped ({exc})", file=sys.stderr)
            return {"name": "", "read": ""}
    return {"name": str(data.get("name") or "")[:60], "read": str(data.get("read") or "")[:400]}


@router.delete("/whiteboards/{board_id}")
def delete_whiteboard(
    board_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    board = db.get(models.GameWhiteboard, board_id)
    if not board or board.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Whiteboard not found")
    db.delete(board)
    db.commit()
    return {"ok": True}
