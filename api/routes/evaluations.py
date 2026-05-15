import re
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models, schemas

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

router = APIRouter(prefix="/evaluations", tags=["evaluations"])


@router.post("", response_model=schemas.EvalOut)
async def submit_evaluation(
    player_id: int = Form(...),
    output_type: str = Form(...),
    competition_level: str = Form("HS Varsity"),
    coach_notes: str | None = Form(None),
    focus_prompt: str | None = Form(None),
    interval_seconds: float = Form(5.0),
    max_frames: int = Form(10),
    include_audio: bool = Form(False),
    video: UploadFile = File(...),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    # Save uploaded video to disk
    suffix = Path(video.filename or "video.mp4").suffix
    dest = UPLOAD_DIR / f"eval_{player_id}_{coach.id}{suffix}"
    with dest.open("wb") as f:
        shutil.copyfileobj(video.file, f)

    # Build focus prompt combining coach notes + any explicit focus
    combined_focus = ""
    if coach_notes:
        combined_focus += f"Coach notes:\n{coach_notes}\n\n"
    if focus_prompt:
        combined_focus += focus_prompt

    # Run BIM analysis
    import sys
    sys.path.insert(0, ".")
    from video_vision.server import _handle_analyze_basketball_video

    result = await _handle_analyze_basketball_video({
        "video_path": str(dest),
        "output_type": output_type,
        "program_name": coach.program_name,
        "competition_level": competition_level,
        "coach_weight": coach.weight,
        "player_name": player.name,
        "focus_prompt": combined_focus,
        "interval_seconds": interval_seconds,
        "max_frames": max_frames,
        "include_audio": include_audio,
    })

    report_text = result[0].text

    # Parse overall grade from report
    overall_grade = _parse_grade(report_text)
    pillar_grades = _parse_pillar_grades(report_text)
    key_questions = _parse_list_section(report_text, "KEY QUESTIONS")
    green_flags   = _parse_list_section(report_text, "GREEN FLAGS")
    watch_flags   = _parse_list_section(report_text, "WATCH FLAGS")

    eval_record = models.Evaluation(
        player_id=player_id,
        coach_id=coach.id,
        output_type=output_type,
        competition_level=competition_level,
        coach_weight=coach.weight,
        coach_notes=coach_notes,
        video_path=str(dest),
        report_text=report_text,
        overall_grade=overall_grade,
        pillar_grades=pillar_grades,
        key_questions=key_questions,
        green_flags=green_flags,
        watch_flags=watch_flags,
    )
    db.add(eval_record)
    db.commit()
    db.refresh(eval_record)
    return eval_record


@router.get("/recent", response_model=list[schemas.EvalWithPlayerOut])
def recent_evaluations(
    limit: int = 30,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    evals = (
        db.query(models.Evaluation)
        .order_by(models.Evaluation.id.desc())
        .limit(limit)
        .all()
    )
    results = []
    for ev in evals:
        player = db.get(models.Player, ev.player_id)
        out = schemas.EvalWithPlayerOut.model_validate(ev)
        out.player_name = player.name if player else "Unknown"
        results.append(out)
    return results


@router.post("/team-report", response_model=schemas.SummaryOut)
async def team_report(
    body: schemas.TeamReportRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    players = db.query(models.Player).all()
    if not players:
        raise HTTPException(status_code=400, detail="No players on roster yet")

    roster_context = ""
    for p in players:
        evals = p.evaluations
        if evals:
            latest = evals[-1]
            grade_str = f"{latest.overall_grade:.1f}/10" if latest.overall_grade else "N/A"
            flags = ", ".join((latest.green_flags or [])[:3])
            watch = ", ".join((latest.watch_flags or [])[:3])
            roster_context += (
                f"- {p.name} ({p.position or 'N/A'}, {p.competition_level}): "
                f"Grade {grade_str}. Strengths: {flags or 'N/A'}. Watch: {watch or 'N/A'}.\n"
            )
        else:
            roster_context += f"- {p.name} ({p.position or 'N/A'}): No evaluations yet.\n"

    focus = body.focus_prompt or ""
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model. Generate a {body.output_type.replace('_', ' ')} "
        f"for the entire {coach.program_name} roster.\n\n"
        f"ROSTER SUMMARY:\n{roster_context}\n\n"
        f"{('COACH FOCUS: ' + focus) if focus else ''}\n\n"
        "Provide a comprehensive team analysis covering overall team grade, team strengths, "
        "areas to develop, lineup recommendations, and strategic priorities. "
        "Use the BIM framework with 6 pillars. Format with clear sections."
    )

    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model="claude-opus-4-7",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        text_blocks = [b for b in response.content if hasattr(b, "text")]
        if not text_blocks:
            raise HTTPException(status_code=500, detail="AI returned no text content")
        return schemas.SummaryOut(report_text=text_blocks[0].text)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")


@router.get("/{eval_id}", response_model=schemas.EvalOut)
def get_evaluation(
    eval_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    ev = db.get(models.Evaluation, eval_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return ev


@router.post("/{eval_id}/corrections", response_model=schemas.CorrectionOut)
def submit_correction(
    eval_id: int,
    body: schemas.CorrectionCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    ev = db.get(models.Evaluation, eval_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    correction = models.Correction(
        evaluation_id=eval_id,
        coach_id=coach.id,
        pillar=body.pillar,
        original_text=body.original_text,
        correction=body.correction,
        coach_weight=coach.weight,
    )
    db.add(correction)
    db.commit()
    db.refresh(correction)
    return correction


@router.get("/{eval_id}/corrections", response_model=list[schemas.CorrectionOut])
def list_corrections(
    eval_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    return db.query(models.Correction).filter_by(evaluation_id=eval_id).all()


# ── Parsing helpers ────────────────────────────────────────────────────────────

def _parse_grade(text: str) -> float | None:
    m = re.search(r"OVERALL GRADE[:\s]+(\d+\.?\d*)\s*/\s*10", text, re.IGNORECASE)
    return float(m.group(1)) if m else None


def _parse_pillar_grades(text: str) -> dict:
    grades = {}
    for m in re.finditer(
        r"PILLAR\s+\d+[^:]*:\s*(.+?)\n.*?GRADE[:\s]+(\d+\.?\d*)\s*/\s*10",
        text, re.IGNORECASE | re.DOTALL
    ):
        name = m.group(1).strip().lower().replace(" ", "_").replace("·", "").strip("_")
        grades[name] = float(m.group(2))
    return grades


def _parse_list_section(text: str, section: str) -> list[str]:
    pattern = rf"{re.escape(section)}[:\s]*\n((?:[-·*\d\.\s].+\n?)+)"
    m = re.search(pattern, text, re.IGNORECASE)
    if not m:
        return []
    lines = [
        re.sub(r"^[-·*\d\.\s]+", "", l).strip()
        for l in m.group(1).splitlines()
        if l.strip()
    ]
    return [l for l in lines if l]
