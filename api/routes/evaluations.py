import re
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
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


@router.get("/team-reports/recent", response_model=list[schemas.TeamReportOut])
def recent_team_reports(
    limit: int = 30,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    return (
        db.query(models.TeamReport)
        .filter_by(coach_id=coach.id)
        .order_by(models.TeamReport.id.desc())
        .limit(limit)
        .all()
    )


@router.post("/team-report", response_model=schemas.SummaryOut)
async def team_report(
    output_type: str = Form("coaching_report"),
    focus_prompt: str | None = Form(None),
    team_id: int | None = Form(None),
    video: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not set on the server. Ask the server admin to configure it."
        )
    query = db.query(models.Player)
    if team_id is not None:
        query = query.filter_by(team_id=team_id)
    players = query.all()
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

    # Optional video analysis for additional context
    video_context = ""
    if video and video.filename:
        suffix = Path(video.filename).suffix
        vid_dest = UPLOAD_DIR / f"team_report_{coach.id}{suffix}"
        with vid_dest.open("wb") as f:
            shutil.copyfileobj(video.file, f)
        try:
            from video_vision.server import _handle_analyze_basketball_video
            vid_result = await _handle_analyze_basketball_video({
                "video_path": str(vid_dest),
                "output_type": output_type,
                "program_name": coach.program_name,
                "competition_level": "Team",
                "coach_weight": coach.weight,
                "player_name": "Team",
                "focus_prompt": focus_prompt or "",
                "interval_seconds": 5.0,
                "max_frames": 8,
                "include_audio": False,
            })
            video_context = f"\n\nVIDEO ANALYSIS:\n{vid_result[0].text}\n"
        except Exception:
            pass  # Video analysis optional — proceed without it

    focus = focus_prompt or ""
    team_label = coach.program_name
    if team_id is not None:
        team_obj = db.get(models.Team, team_id)
        if team_obj:
            team_label = f"{team_obj.name} ({coach.program_name})"
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model. Generate a {output_type.replace('_', ' ')} "
        f"for the {team_label} roster.\n\n"
        f"ROSTER SUMMARY:\n{roster_context}\n\n"
        f"{('COACH FOCUS: ' + focus) if focus else ''}"
        f"{video_context}\n\n"
        "Provide a comprehensive team analysis covering overall team grade, team strengths, "
        "areas to develop, lineup recommendations, and strategic priorities. "
        "Use the BIM framework with 6 pillars. Format with clear sections."
    )

    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model="claude-opus-4-7",
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        text_blocks = [b for b in response.content if hasattr(b, "text")]
        if not text_blocks:
            raise HTTPException(status_code=500, detail="AI returned no text content")
        team_report_record = models.TeamReport(
            coach_id=coach.id,
            output_type=output_type,
            focus_prompt=focus_prompt,
            report_text=text_blocks[0].text,
        )
        db.add(team_report_record)
        db.commit()
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


@router.delete("/{eval_id}")
def delete_evaluation(
    eval_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    ev = db.get(models.Evaluation, eval_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    db.delete(ev)
    db.commit()
    return {"ok": True}


@router.delete("/team-reports/{report_id}")
def delete_team_report(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    tr = db.get(models.TeamReport, report_id)
    if not tr:
        raise HTTPException(status_code=404, detail="Team report not found")
    db.delete(tr)
    db.commit()
    return {"ok": True}


class TeamReportCorrectBody(BaseModel):
    correction: str


@router.post("/team-reports/{report_id}/correct", response_model=schemas.TeamReportOut)
async def correct_team_report(
    report_id: int,
    body: TeamReportCorrectBody,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    tr = db.get(models.TeamReport, report_id)
    if not tr or not tr.report_text:
        raise HTTPException(status_code=404, detail="Team report not found")

    prompt = (
        f"You are a basketball analysis expert. Below is a team report followed by a correction from the coach. "
        f"Update the report to incorporate this correction, adding or removing detail as needed. "
        f"Return ONLY the updated report text in the same format.\n\n"
        f"ORIGINAL REPORT:\n{tr.report_text}\n\n"
        f"CORRECTION:\n{body.correction}\n\n"
        f"UPDATED REPORT:"
    )
    import anthropic
    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    tr.report_text = response.content[0].text.strip()
    db.commit()
    db.refresh(tr)
    return tr


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


@router.post("/{eval_id}/apply-corrections", response_model=schemas.EvalOut)
async def apply_corrections(
    eval_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    ev = db.get(models.Evaluation, eval_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    corrections = db.query(models.Correction).filter_by(evaluation_id=eval_id).all()
    if not corrections or not ev.report_text:
        return ev

    corrections_text = "\n".join(
        f"- [{c.pillar or 'General'}] {c.correction}" for c in corrections
    )
    prompt = (
        f"You are a basketball evaluation expert. Below is an existing evaluation report "
        f"followed by a list of corrections from the coach. Update the report to incorporate "
        f"these corrections, adding or removing detail as needed. Return ONLY the updated report text, "
        f"maintaining the same format and structure.\n\n"
        f"ORIGINAL REPORT:\n{ev.report_text}\n\n"
        f"CORRECTIONS:\n{corrections_text}\n\n"
        f"UPDATED REPORT:"
    )

    import anthropic
    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    updated_text = response.content[0].text.strip()

    ev.report_text = updated_text
    db.commit()
    db.refresh(ev)
    return ev


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
