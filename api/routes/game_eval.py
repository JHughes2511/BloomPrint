"""Game Evaluation routes — BIM game-by-game grading system."""

import difflib
import io
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models, schemas

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


def _quarter_multiplier(quarter: int) -> float:
    if quarter <= 2:
        return 1.0
    elif quarter == 3:
        return 1.25
    else:  # Q4 or OT
        return 1.5


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


def _get_game(db: Session, game_id: int, coach_id: int) -> models.GameSession:
    game = db.get(models.GameSession, game_id)
    if not game or game.coach_id != coach_id:
        raise HTTPException(status_code=404, detail="Game session not found")
    return game


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
    )
    if body.date:
        try:
            game.date = datetime.fromisoformat(body.date)
        except ValueError:
            pass
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
    q = db.query(models.GameSession).filter_by(coach_id=coach.id)
    if season_phase:
        q = q.filter(models.GameSession.season_phase == season_phase)
    if season_year:
        q = q.filter(models.GameSession.season_year == season_year)
    return q.order_by(models.GameSession.date.desc()).all()


@router.get("/sessions/{game_id}", response_model=schemas.GameSessionOut)
def get_session(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    return _get_game(db, game_id, coach.id)


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
    db.delete(game)
    db.commit()
    return {"ok": True}


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/sessions/{game_id}/stats")
def list_stats(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game(db, game_id, coach.id)
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
    game = _get_game(db, game_id, coach.id)
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
    game = _get_game(db, game_id, coach.id)

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

    game_out = schemas.GameSessionOut.model_validate(game)
    return {
        "game": game_out.model_dump(),
        "player_grades": player_grades,
        "team_grade": team_grade,
        "opponent_grades": opponent_grades,
    }


# ── Upload Excel ──────────────────────────────────────────────────────────────

@router.post("/sessions/{game_id}/upload")
async def upload_excel(
    game_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game(db, game_id, coach.id)
    content = await file.read()

    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read Excel file: {e}")

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
            if stat_name in OFFENSE_STATS:
                stat_category = "offense"
            else:
                stat_category = "defense"

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
                multiplier = 1.0  # default Q1/Q2 for imports
                weighted = raw_points * multiplier

                stat = models.GamePlayerStat(
                    game_id=game.id,
                    player_name=player_name,
                    is_opponent="opp" in sheet_name.lower() or "opponent" in sheet_name.lower(),
                    quarter=1,
                    stat_name=stat_name,
                    stat_category=stat_category,
                    raw_points=raw_points,
                    quarter_multiplier=multiplier,
                    weighted_points=weighted,
                    count=count,
                )
                db.add(stat)
                imported += 1

    db.commit()
    return {"imported": imported}


# ── AI Scouting Report ────────────────────────────────────────────────────────

@router.post("/sessions/{game_id}/ai-scouting")
async def generate_ai_scouting(
    game_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    game = _get_game(db, game_id, coach.id)

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

    # Load coach notes for this opponent
    notes = (
        db.query(models.OpponentNote)
        .filter_by(coach_id=coach.id, opponent_name=game.opponent_name)
        .order_by(models.OpponentNote.created_at)
        .all()
    )
    notes_text = ""
    if notes:
        notes_text = "\n\nCOACH NOTES (observed by coaching staff):\n" + "\n".join(f"- {n.note_text}" for n in notes)

    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model. "
        f"Generate a pre-game scouting report for the opponent: {game.opponent_name}\n\n"
        f"Game date: {game.date}\n"
        f"{score_info}\n\n"
        f"OPPONENT PLAYER GRADES:\n{opp_context}"
        f"{notes_text}\n\n"
        f"Analyze the opponent's strengths, weaknesses, top players to watch, offensive tendencies, "
        f"defensive tendencies, and strategic recommendations for the next game against them. "
        f"IMPORTANT: Do NOT use ## headers, ** bold markers, or dividers. "
        f"Use plain section titles in ALL CAPS followed by a colon and newline."
    )

    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model="claude-opus-4-7",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        text_blocks = [b for b in response.content if hasattr(b, "text")]
        if not text_blocks:
            raise HTTPException(status_code=500, detail="AI returned no content")
        report_text = text_blocks[0].text
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    game.ai_scouting_report = report_text
    db.commit()
    return {"ai_scouting_report": report_text}


# ── Season Dashboard ──────────────────────────────────────────────────────────

@router.get("/season-dashboard")
def season_dashboard(
    phases: str | None = None,   # comma-separated, e.g. "playoff,tournament"
    season_year: str | None = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    q = db.query(models.GameSession).filter_by(coach_id=coach.id, status="completed")
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
    games = (
        db.query(models.GameSession)
        .filter_by(coach_id=coach.id, opponent_name=opponent_name)
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
        if game.ai_scouting_report:
            latest_report = game.ai_scouting_report
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
