"""Short versions of reports (api/short_versions.py): read one, or make it again."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from .. import short_versions as sv
from ..auth import get_current_coach
from ..database import get_db

router = APIRouter(prefix="/short", tags=["short-versions"])


PUBLIC_KINDS = sv.KINDS | {"packet"}


def _resolve(db: Session, coach: models.Coach, kind: str, ref_id: int) -> tuple[str, int]:
    """The stored report a request means, checked as the coach's own.

    Game reports are one per coach per game, so scouting / game_full /
    play_calling are asked for by GAME id and resolve to this coach's report.
    A packet is asked for by packet id and resolves to its current version.
    """
    if kind not in PUBLIC_KINDS:
        raise HTTPException(status_code=404, detail="Unknown report kind")
    table = {"scouting": models.GameScoutingReport, "game_full": models.GameFullReport,
             "play_calling": models.PlayCallingReport}.get(kind)
    if table is not None:
        row = db.query(table).filter_by(game_id=ref_id, coach_id=coach.id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Report not found")
        kind, ref_id = kind, row.id
    elif kind == "packet":
        gr = db.get(models.GameReport, ref_id)
        if not gr or gr.coach_id != coach.id:
            raise HTTPException(status_code=404, detail="Report not found")
        if "team_training" in sv._types(gr.output_type):
            kind, ref_id = "packet_training", gr.id
        else:
            v = db.query(models.GameReportVersion).filter_by(game_report_id=gr.id, output_type=gr.output_type).first()
            if v is None:
                raise HTTPException(status_code=404, detail="Report not found")
            kind, ref_id = "packet_version", v.id
    elif kind == "packet_version":
        v = db.get(models.GameReportVersion, ref_id)
        if v is not None and "team_training" in sv._types(v.output_type):
            kind, ref_id = "packet_training", v.game_report_id
    if kind in ("player_share", "player_team_share"):
        raise HTTPException(status_code=404, detail="Report not found")
    if kind == "shared":
        sh = db.get(models.StaffSharedReport, ref_id)
        if sh and coach.id in (sh.recipient_id, sh.sender_id):
            return kind, ref_id
        raise HTTPException(status_code=404, detail="Report not found")
    _, owner = sv.source_text(db, kind, ref_id)
    if owner == coach.id:
        return kind, ref_id
    if kind == "training":
        s_ = db.get(models.TrainingSession, ref_id)
        if s_ and s_.player:
            from ..injuries import can_manage_player
            if can_manage_player(db, coach, s_.player):
                return kind, ref_id
    raise HTTPException(status_code=404, detail="Report not found")


@router.get("/{kind}/{ref_id}")
def get_short(kind: str, ref_id: int, db: Session = Depends(get_db),
              coach: models.Coach = Depends(get_current_coach)):
    """The short version; starts making it when missing or out of date."""
    kind, ref_id = _resolve(db, coach, kind, ref_id)
    return sv.out(sv.ensure(db, kind, ref_id), db)


@router.post("/{kind}/{ref_id}/remake")
def remake_short(kind: str, ref_id: int, db: Session = Depends(get_db),
                 coach: models.Coach = Depends(get_current_coach)):
    kind, ref_id = _resolve(db, coach, kind, ref_id)
    return sv.out(sv.ensure(db, kind, ref_id, force=True), db)


class EditIn(BaseModel):
    data: dict


@router.put("/{kind}/{ref_id}")
def edit_short(kind: str, ref_id: int, body: EditIn, db: Session = Depends(get_db),
               coach: models.Coach = Depends(get_current_coach)):
    """Save the coach's edits to the page (every field)."""
    kind, ref_id = _resolve(db, coach, kind, ref_id)
    return sv.out(sv.save_edit(db, kind, ref_id, body.data), db)


class CorrectIn(BaseModel):
    correction: str


@router.post("/{kind}/{ref_id}/correct")
def correct_short(kind: str, ref_id: int, body: CorrectIn, db: Session = Depends(get_db),
                  coach: models.Coach = Depends(get_current_coach)):
    """Apply a written correction to the page; comes back in the same format."""
    kind, ref_id = _resolve(db, coach, kind, ref_id)
    if not body.correction.strip():
        raise HTTPException(status_code=400, detail="Say what to correct.")
    row = sv.correct(db, kind, ref_id, body.correction.strip())
    if row is None:
        raise HTTPException(status_code=400, detail="Make the short version first.")
    return sv.out(row, db)
