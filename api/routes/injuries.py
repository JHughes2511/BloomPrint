"""Injury log endpoints: a roster player's, or a player known by name (an
opponent). The rules on who may see and change them live in api/injuries.py."""
from __future__ import annotations

from datetime import date

import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import injuries as inj
from .. import models
from ..auth import get_current_coach
from ..database import get_db

router = APIRouter(prefix="/injuries", tags=["injuries"])


class InjuryIn(BaseModel):
    player_id: int | None = None
    team_name: str | None = None
    player_name: str | None = None
    status: str | None = None
    body_part: str | None = None
    side: str | None = None
    description: str | None = None
    injured_on: date | None = None
    expected_return: date | None = None
    returned_on: date | None = None
    notes: str | None = None


def _player(db: Session, coach: models.Coach, player_id: int) -> models.Player:
    p = db.get(models.Player, player_id)
    if not p or getattr(p, "deleted_at", None) or not inj.can_manage_player(db, coach, p):
        raise HTTPException(status_code=404, detail="Player not found")
    return p


def _apply(i: models.PlayerInjury, body: InjuryIn, fields: set[str]) -> None:
    if "status" in fields:
        if body.status not in inj.STATUSES:
            raise HTTPException(status_code=400, detail="Unknown status")
        i.status = body.status
    for f in ("body_part", "side", "description", "notes"):
        if f in fields:
            v = (getattr(body, f) or "").strip()
            setattr(i, f, v[:2000] if v else None)
    for f in ("injured_on", "expected_return", "returned_on"):
        if f in fields:
            setattr(i, f, getattr(body, f))


@router.get("/players/{player_id}")
def player_injuries(player_id: int, db: Session = Depends(get_db),
                    coach: models.Coach = Depends(get_current_coach)):
    p = _player(db, coach, player_id)
    return [inj.out(i) for i in inj.for_player(db, p)]


@router.get("/current")
def current_injuries(db: Session = Depends(get_db), coach: models.Coach = Depends(get_current_coach)):
    """Every current injury this coach can see, to tag players with."""
    return inj.visible_current(db, coach)


@router.get("/named")
def named_injuries(player_name: str, team_name: str | None = None, db: Session = Depends(get_db),
                   coach: models.Coach = Depends(get_current_coach)):
    return [inj.out(i) for i in inj.for_name(db, coach, team_name, player_name)]


@router.post("")
def add_injury(body: InjuryIn, db: Session = Depends(get_db),
               coach: models.Coach = Depends(get_current_coach)):
    if not body.player_id and body.player_name:
        # A name that is one of the coach's roster players goes on the player.
        rp = inj.roster_player(db, coach, body.team_name, body.player_name)
        if rp is not None:
            body.player_id = rp.id
    if body.player_id:
        p = _player(db, coach, body.player_id)
        i = models.PlayerInjury(player_id=p.id, player_name=p.name, coach_id=coach.id, source="manual")
    else:
        name = (body.player_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Which player?")
        i = models.PlayerInjury(player_name=name[:120], team_name=(body.team_name or "").strip()[:120] or None,
                                coach_id=coach.id, source="manual")
    body.status = body.status or "out"
    _apply(i, body, set(body.model_fields_set) | {"status"})
    db.add(i)
    db.commit()
    db.refresh(i)
    return inj.out(i)


@router.patch("/{injury_id}")
def edit_injury(injury_id: int, body: InjuryIn, db: Session = Depends(get_db),
                coach: models.Coach = Depends(get_current_coach)):
    i = db.get(models.PlayerInjury, injury_id)
    if not i or not inj.can_manage(db, coach, i):
        raise HTTPException(status_code=404, detail="Injury not found")
    _apply(i, body, set(body.model_fields_set) - {"player_id", "team_name", "player_name"})
    db.commit()
    db.refresh(i)
    return inj.out(i)


@router.delete("/{injury_id}")
def delete_injury(injury_id: int, db: Session = Depends(get_db),
                  coach: models.Coach = Depends(get_current_coach)):
    i = db.get(models.PlayerInjury, injury_id)
    if not i or not inj.can_manage(db, coach, i):
        raise HTTPException(status_code=404, detail="Injury not found")
    db.delete(i)
    db.commit()
    return {"ok": True}


# ── Import: a team's injury report, read into a preview the coach confirms ──

IMPORT_INSTRUCTION = """You are reading a basketball team's INJURY REPORT (a photo, screenshot, PDF or
spreadsheet). Return JSON only:
{"team": "<team named on the report, or null>",
 "injuries": [{"player": "<name as written>", "jersey": "<number or null>",
               "status": "out|dtd|questionable|playing_through|cleared",
               "body_part": "<e.g. Ankle, Hamstring, Oblique, or null>",
               "side": "left|right|both|null",
               "description": "<what it is: Bruise, Soreness, Sprain, Strain... or null>",
               "injured_on": "YYYY-MM-DD or null",
               "expected_return": "YYYY-MM-DD or null",
               "returned_on": "YYYY-MM-DD or null",
               "notes": "<anything else the report says about this injury, or null>"}]}
Rules:
- One entry per INJURY. A player listed with a current injury AND a recent one gives two entries.
- A current injury: OUT -> "out"; DTD / day-to-day -> "dtd"; GTD, questionable, doubtful -> "questionable";
  probable / playing / available with an injury -> "playing_through". Its expected return goes in expected_return.
- A recent injury the player has returned from: status "cleared" and its date in returned_on.
- "Right Ankle Bruise" -> side right, body_part Ankle, description Bruise.
- Only dates printed on the report, as YYYY-MM-DD. Never guess a date.
- Skip players with no injury. Ignore columns that are not about injuries (minutes, games started, news headlines).
- Do not invent players or injuries."""


def _date(v):
    from datetime import date as _d
    if not v or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(v).strip()):
        return None
    try:
        return _d.fromisoformat(str(v).strip()).isoformat()
    except ValueError:
        return None


@router.post("/import/read")
async def import_read(file: UploadFile = File(...), team_name: str | None = Form(None),
                      db: Session = Depends(get_db), coach: models.Coach = Depends(get_current_coach)):
    """Read an injury report into rows to confirm. Nothing is saved."""
    from .. import ai_import
    from ..uploadguard import read_upload
    data = await read_upload(file, what="document")
    try:
        got = ai_import.ai_extract_json(data, file.filename or "", file.content_type, IMPORT_INSTRUCTION) or {}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not isinstance(got, dict):
        got = {}
    rows = []
    for r in got.get("injuries") or []:
        if not isinstance(r, dict) or not str(r.get("player") or "").strip():
            continue
        status = str(r.get("status") or "").strip().lower()
        side = str(r.get("side") or "").strip().lower()
        row = {"player_name": str(r["player"]).strip()[:120],
               "jersey": (str(r.get("jersey")).strip()[:6] if r.get("jersey") not in (None, "") else None),
               "status": status if status in inj.STATUSES else "out",
               "body_part": (str(r.get("body_part") or "").strip()[:60] or None),
               "side": side if side in ("left", "right", "both") else None,
               "description": (str(r.get("description") or "").strip()[:120] or None),
               "injured_on": _date(r.get("injured_on")), "expected_return": _date(r.get("expected_return")),
               "returned_on": _date(r.get("returned_on")),
               "notes": (str(r.get("notes") or "").strip()[:500] or None)}
        rp = inj.roster_player(db, coach, team_name, row["player_name"]) if team_name else None
        row["player_id"] = rp.id if rp else None
        rows.append(row)
    return {"team": got.get("team"), "injuries": rows}


class ImportSaveIn(BaseModel):
    team_name: str | None = None
    injuries: list[InjuryIn]


@router.post("/import/save")
def import_save(body: ImportSaveIn, db: Session = Depends(get_db),
                coach: models.Coach = Depends(get_current_coach)):
    """Save confirmed rows. The same injury already on file (same player, body
    part and side, still current) is updated rather than logged twice."""
    saved = updated = 0
    for row in body.injuries:
        name = (row.player_name or "").strip()
        if not name and not row.player_id:
            continue
        p = None
        if row.player_id:
            p = _player(db, coach, row.player_id)
        elif body.team_name:
            p = inj.roster_player(db, coach, body.team_name, name)
        existing = inj.for_player(db, p) if p else inj.for_name(db, coach, body.team_name, name)
        same = next((i for i in existing
                     if inj._norm(i.body_part) == inj._norm(row.body_part) and inj._norm(i.side) == inj._norm(row.side)
                     and (inj.is_current(i) or (row.returned_on and i.returned_on == row.returned_on))), None)
        if same is None:
            same = (models.PlayerInjury(player_id=p.id, player_name=p.name, coach_id=coach.id, source="import") if p else
                    models.PlayerInjury(player_name=name[:120], team_name=(body.team_name or "").strip()[:120] or None,
                                        coach_id=coach.id, source="import"))
            db.add(same)
            saved += 1
        else:
            updated += 1
        row.status = row.status if row.status in inj.STATUSES else "out"
        fields = {"status", "body_part", "side", "description", "injured_on", "expected_return", "returned_on", "notes"}
        # Only what the report gave: an empty cell does not wipe what is on file.
        fields = {f for f in fields if getattr(row, f) not in (None, "")} | {"status"}
        _apply(same, row, fields)
    db.commit()
    return {"saved": saved, "updated": updated}
