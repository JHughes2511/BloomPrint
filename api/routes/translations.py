"""On-view report translation.

Reports are stored in whatever language they were generated in — that text is the
source of truth and is never rewritten. When a coach reads a report in a
different language we translate it on view and cache the result, so the second
read is free and the original stays available behind a toggle.

Access is scoped per report type: you can only translate something you own or
that was legitimately shared with you.
"""
import hashlib
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models
from ..coach_context import LANGUAGE_NAMES

router = APIRouter(prefix="/translations", tags=["translations"])


class TranslateReportBody(BaseModel):
    report_type: str            # eval | team_report | game | game_session | game_report | training | shared
    report_id: int
    target_lang: str


def _source_text(db: Session, coach: models.Coach, kind: str, rid: int) -> str | None:
    """Return the report's text ONLY if this coach may read it.

    Ownership is checked per type rather than trusting the id, so this endpoint
    can't be used to read another coach's report.
    """
    if kind == "eval":
        row = db.get(models.Evaluation, rid)
        return row.report_text if row and row.coach_id == coach.id else None
    if kind in ("team_report", "team_training"):
        row = db.get(models.TeamReport, rid)
        return row.report_text if row and row.coach_id == coach.id else None
    if kind == "game":
        row = db.get(models.GameReport, rid)
        return row.report_text if row and row.coach_id == coach.id else None
    if kind == "training":
        row = db.get(models.TrainingSession, rid)
        return row.program_text if row and row.coach_id == coach.id else None
    if kind == "game_session":
        row = db.query(models.GameScoutingReport).filter_by(game_id=rid, coach_id=coach.id).first()
        return row.report_text if row else None
    if kind == "game_report":
        row = db.query(models.GameFullReport).filter_by(game_id=rid, coach_id=coach.id).first()
        return row.report_text if row else None
    if kind == "shared":
        # A report shared WITH this coach: their regenerated copy, else the
        # frozen snapshot, else the live text the sharer allowed.
        sr = db.get(models.StaffSharedReport, rid)
        if not sr or sr.recipient_id != coach.id:
            return None
        if sr.regenerated_text:
            return sr.regenerated_text
        if sr.frozen_text:
            return sr.frozen_text
        from .staff_sharing import _resolve_report_text
        return _resolve_report_text(sr.report_type, sr.report_id, db, sr.sender_id)
    return None


@router.post("/report")
async def translate_report(
    body: TranslateReportBody,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    lang = (body.target_lang or "").strip().lower()
    if not lang or lang == "en":
        raise HTTPException(status_code=400, detail="Pick a target language other than English.")
    if lang not in LANGUAGE_NAMES:
        raise HTTPException(status_code=400, detail="That language isn't supported yet.")

    text = _source_text(db, coach, body.report_type, body.report_id)
    if not text or not text.strip():
        raise HTTPException(status_code=404, detail="Report not found.")

    src_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    cached = (
        db.query(models.ReportTranslation)
        .filter_by(report_type=body.report_type, report_id=body.report_id, lang=lang)
        .first()
    )
    if cached and cached.source_hash == src_hash:
        return {"text": cached.text, "cached": True, "language": lang}

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured.")

    name = LANGUAGE_NAMES.get(lang, lang)
    prompt = (
        f"Translate this basketball report into {name}.\n\n"
        "RULES:\n"
        f"- Use the basketball terminology a native {name}-speaking coach actually uses.\n"
        "- Keep the EXACT structure: same section order, same ALL-CAPS section headers "
        "(translated), same bullets, same table layout, same line breaks.\n"
        "- Keep player names, team names, opponent names and dates unchanged.\n"
        "- Keep numbers, grades (e.g. 7.5/10) and stat abbreviations (PPG, FG%, OFF, DEF) as they are.\n"
        "- Translate only the prose. Do not summarize, shorten, add, or re-analyze anything.\n"
        "- Return ONLY the translated report, with no preamble.\n\n"
        f"REPORT:\n{text}"
    )
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        resp = await client.messages.create(
            model="claude-opus-4-7",
            max_tokens=16000,
            messages=[{"role": "user", "content": prompt}],
        )
        blocks = [b for b in resp.content if hasattr(b, "text")]
        if not blocks:
            raise HTTPException(status_code=502, detail="Translation returned no content.")
        translated = blocks[0].text.strip()
    except HTTPException:
        raise
    except Exception:
        # The caller falls back to showing the original.
        raise HTTPException(status_code=502, detail="Could not translate this report right now.")

    if cached:
        cached.text = translated
        cached.source_hash = src_hash
    else:
        db.add(models.ReportTranslation(
            report_type=body.report_type, report_id=body.report_id,
            lang=lang, source_hash=src_hash, text=translated,
        ))
    db.commit()
    return {"text": translated, "cached": False, "language": lang}
