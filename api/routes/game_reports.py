"""Game Report Packet routes — persistent multi-source report builder."""

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

router = APIRouter(prefix="/game-reports", tags=["game-reports"])


def _build_out(gr: models.GameReport) -> schemas.GameReportOut:
    out = schemas.GameReportOut.model_validate(gr)
    out.my_team_name = gr.my_team.name if gr.my_team else None
    out.opponent_team_name = gr.opponent_team.name if gr.opponent_team else None
    return out


@router.get("", response_model=list[schemas.GameReportOut])
def list_game_reports(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    reports = (
        db.query(models.GameReport)
        .filter_by(coach_id=coach.id)
        .order_by(models.GameReport.updated_at.desc())
        .all()
    )
    return [_build_out(r) for r in reports]


@router.post("", response_model=schemas.GameReportOut)
def create_game_report(
    body: schemas.GameReportCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = models.GameReport(coach_id=coach.id, **body.model_dump())
    db.add(gr)
    db.commit()
    db.refresh(gr)
    return _build_out(gr)


@router.get("/{report_id}", response_model=schemas.GameReportOut)
def get_game_report(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    return _build_out(gr)


@router.patch("/{report_id}", response_model=schemas.GameReportOut)
def update_game_report(
    report_id: int,
    body: schemas.GameReportUpdate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(gr, field, value)
    db.commit()
    db.refresh(gr)
    return _build_out(gr)


@router.delete("/{report_id}")
def delete_game_report(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    db.delete(gr)
    db.commit()
    return {"ok": True}


@router.post("/{report_id}/clips", response_model=schemas.GameReportClipOut)
async def add_clip(
    report_id: int,
    label: str = Form(...),
    video: UploadFile = File(...),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")

    suffix = Path(video.filename or "clip.mp4").suffix
    dest = UPLOAD_DIR / f"gr_{report_id}_clip_{len(gr.clips)}{suffix}"
    with dest.open("wb") as f:
        shutil.copyfileobj(video.file, f)

    # Determine context label for AI
    label_text = "my team" if label == "my_team" else "the opponent"
    my_team_name = gr.my_team.name if gr.my_team else coach.program_name
    opp_name = gr.opponent_team.name if gr.opponent_team else (gr.opponent_name or "Opponent")

    import sys
    sys.path.insert(0, ".")
    from video_vision.server import _handle_analyze_basketball_video

    result = await _handle_analyze_basketball_video({
        "video_path": str(dest),
        "output_type": gr.output_type,
        "program_name": my_team_name,
        "competition_level": "HS Varsity",
        "coach_weight": coach.weight,
        "player_name": label_text,
        "focus_prompt": f"This film is of {label_text}. My team: {my_team_name}. Opponent: {opp_name}.\n{gr.focus_prompt or ''}",
        "interval_seconds": 5.0,
        "max_frames": 10,
        "include_audio": False,
    })
    analysis_text = result[0].text

    clip = models.GameReportClip(
        game_report_id=report_id,
        video_path=str(dest),
        label=label,
        analysis_text=analysis_text,
    )
    db.add(clip)
    db.commit()
    db.refresh(clip)
    return clip


@router.delete("/{report_id}/clips/{clip_id}")
def delete_clip(
    report_id: int,
    clip_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    clip = db.get(models.GameReportClip, clip_id)
    if not clip or clip.game_report_id != report_id:
        raise HTTPException(status_code=404, detail="Clip not found")
    db.delete(clip)
    db.commit()
    return {"ok": True}


@router.post("/{report_id}/upload-doc", response_model=schemas.GameReportOut)
async def upload_doc(
    report_id: int,
    doc_type: str = Form(...),  # 'box_score' or 'scouting_notes'
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")

    content = await file.read()
    filename = (file.filename or "").lower()
    text = ""

    if filename.endswith(".txt"):
        text = content.decode("utf-8", errors="replace")
    elif filename.endswith(".pdf"):
        try:
            import pypdf, io
            reader = pypdf.PdfReader(io.BytesIO(content))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")
    elif filename.endswith(".docx"):
        try:
            import docx, io
            doc = docx.Document(io.BytesIO(content))
            text = "\n".join(p.text for p in doc.paragraphs)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read Word doc: {e}")
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use .txt, .pdf, or .docx")

    if doc_type == "box_score":
        gr.box_score = text
    else:
        gr.scouting_notes = text

    db.commit()
    db.refresh(gr)
    return _build_out(gr)


@router.post("/{report_id}/generate", response_model=schemas.GameReportOut)
async def generate_game_report(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")

    my_team_name = gr.my_team.name if gr.my_team else coach.program_name
    opp_name = gr.opponent_team.name if gr.opponent_team else (gr.opponent_name or None)

    # Build matchup header
    if gr.mode == "vs_opponent" and opp_name:
        matchup = f"{my_team_name} vs {opp_name}"
    elif gr.mode == "my_program":
        matchup = my_team_name
    else:
        matchup = opp_name or "Opponent"

    # Build roster context for my team
    my_roster_context = ""
    if gr.my_team_id and gr.mode in ("vs_opponent", "my_program"):
        players = db.query(models.Player).filter_by(team_id=gr.my_team_id).all()
        for p in players:
            parts = [p.name]
            if p.position: parts.append(p.position)
            if p.height: parts.append(p.height)
            if p.wingspan: parts.append(f"ws:{p.wingspan}")
            evals = p.evaluations
            if evals:
                latest = evals[-1]
                grade_str = f"{latest.overall_grade:.1f}/10" if latest.overall_grade else "N/A"
                flags = ", ".join((latest.green_flags or [])[:3])
                watch = ", ".join((latest.watch_flags or [])[:3])
                parts.append(f"Grade {grade_str}")
                if flags: parts.append(f"Strengths: {flags}")
                if watch: parts.append(f"Watch: {watch}")
            my_roster_context += f"- {', '.join(parts)}\n"

    # Build opponent roster context
    opp_roster_context = ""
    if gr.opponent_team_id and gr.mode in ("vs_opponent", "opponent_only"):
        players = db.query(models.Player).filter_by(team_id=gr.opponent_team_id).all()
        for p in players:
            parts = [p.name]
            if p.position: parts.append(p.position)
            if p.height: parts.append(p.height)
            if p.wingspan: parts.append(f"ws:{p.wingspan}")
            evals = p.evaluations
            if evals:
                latest = evals[-1]
                grade_str = f"{latest.overall_grade:.1f}/10" if latest.overall_grade else "N/A"
                parts.append(f"Grade {grade_str}")
            opp_roster_context += f"- {', '.join(parts)}\n"

    # Build film analysis context
    film_context = ""
    for clip in gr.clips:
        if clip.analysis_text:
            label_str = "My Team Film" if clip.label == "my_team" else "Opponent Film"
            film_context += f"\n{label_str.upper()}:\n{clip.analysis_text}\n"

    # Assemble prompt
    sections = [
        f"You are the BloomPrint Basketball Intelligence Model.",
        f"Generate a {gr.output_type.replace('_', ' ')} for: {matchup}",
        f"PROGRAM: {my_team_name}",
    ]
    if my_roster_context:
        sections.append(f"\nMY TEAM ROSTER ({my_team_name}):\n{my_roster_context}")
    if opp_roster_context:
        sections.append(f"\nOPPONENT ROSTER ({opp_name}):\n{opp_roster_context}")
    if film_context:
        sections.append(f"\nFILM ANALYSIS:{film_context}")
    if gr.box_score:
        sections.append(f"\nBOX SCORE / STATS:\n{gr.box_score}")
    if gr.scouting_notes:
        sections.append(f"\nSCOUTING NOTES:\n{gr.scouting_notes}")
    if gr.focus_prompt:
        sections.append(f"\nCOACH FOCUS:\n{gr.focus_prompt}")

    sections.append(
        "\nProvide a comprehensive analysis using the BIM framework. "
        "Include strengths, weaknesses, key players, strategic recommendations. "
        "Format with clear sections and headers."
    )

    prompt = "\n".join(sections)

    import anthropic
    client = anthropic.AsyncAnthropic()
    response = await client.messages.create(
        model="claude-opus-4-7",
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )
    text_blocks = [b for b in response.content if hasattr(b, "text")]
    if not text_blocks:
        raise HTTPException(status_code=500, detail="AI returned no content")

    gr.report_text = text_blocks[0].text
    db.commit()
    db.refresh(gr)
    return _build_out(gr)
