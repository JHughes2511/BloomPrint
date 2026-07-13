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

router = APIRouter(prefix="/imports", tags=["imports"])


# ── Roster ────────────────────────────────────────────────────────────────────

@router.post("/roster/preview")
async def roster_preview(
    file: UploadFile = File(...),
    coach: models.Coach = Depends(get_current_coach),
):
    """Extract a roster from any file → a list of players for the coach to
    confirm. Nothing is saved yet."""
    data = await file.read()
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
    program_name = coach.program_name
    if body.team_id:
        team = db.get(models.Team, body.team_id)
        if not team or team.coach_id != coach.id:
            raise HTTPException(status_code=404, detail="Team not found")
        program_name = team.name
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
            competition_level=p.get("competition_level") or body.competition_level,
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
    file: UploadFile = File(...),
    coach: models.Coach = Depends(get_current_coach),
):
    data = await file.read()
    try:
        parsed = ai_import.ai_extract_json(data, file.filename or "", file.content_type, ai_import.GAME_STATS_INSTRUCTION)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    players = (parsed or {}).get("players") if isinstance(parsed, dict) else parsed
    if not isinstance(players, list) or not players:
        raise HTTPException(status_code=422, detail="Couldn't read any stats from that file.")
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
        clean.append({"player_name": name, "is_opponent": bool(p.get("is_opponent")), "stats": norm})
    return {"players": clean}


class GameStatsCommit(BaseModel):
    game_id: int
    players: list[dict]


@router.post("/game-stats/commit")
def game_stats_commit(
    body: GameStatsCommit,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    from .game_eval import _get_game, _import_raw, _quarter_multiplier
    game = _get_game(db, body.game_id, coach.id)
    q, mult = 4, _quarter_multiplier(4)
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
                quarter=q, stat_name=stat, stat_category=("negative" if raw < 0 else "positive"),
                raw_points=raw, quarter_multiplier=mult, weighted_points=raw * mult, count=count,
            ))
            imported += 1
    db.commit()
    return {"imported": imported}


# ── Free-text extraction (notes, focus, box-score text, scouting notes) ───────

@router.post("/text")
async def import_text(
    file: UploadFile = File(...),
    purpose: str = "coaching notes",
    coach: models.Coach = Depends(get_current_coach),
):
    """Return clean extracted text from any file (for Notes / Focus / Box Score /
    Scouting Notes fields). Images and PDFs are transcribed by the model."""
    data = await file.read()
    try:
        text = ai_import.ai_extract_text(data, file.filename or "", file.content_type, purpose)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not text:
        raise HTTPException(status_code=422, detail="No readable text was found in that file.")
    return {"text": text}
