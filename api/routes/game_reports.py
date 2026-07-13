"""Game Report Packet routes — persistent multi-source report builder."""

import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..auth import get_current_coach
from ..report_format import REPORT_FORMAT, REPORT_FORMAT_WITH_TABLES
from .. import models, schemas


def _run_clip_analysis(clip_id: int, job_id: int, video_path: str, output_type: str,
                       program_name: str, opp_name: str, label_text: str,
                       coach_weight: int, focus_prompt: str):
    """Background task: analyze a (possibly hour-long) film and fill in the clip.
    Reports per-segment progress on the GenerationJob so the app shows the same
    "Analyzing segment i of N" bar as the player-eval flow."""
    import asyncio
    db = SessionLocal()
    try:
        import sys
        sys.path.insert(0, ".")
        from video_vision.server import _handle_analyze_basketball_video

        def _prog(done, total, label):
            pdb = SessionLocal()
            try:
                j = pdb.get(models.GenerationJob, job_id)
                if j:
                    j.progress = label
                    pdb.commit()
            finally:
                pdb.close()

        from ..storage import ensure_local
        result = asyncio.run(_handle_analyze_basketball_video({
            "video_path": ensure_local(video_path),
            "output_type": output_type,
            "program_name": program_name,
            "competition_level": "HS Varsity",
            "coach_weight": coach_weight,
            "player_name": label_text,
            "focus_prompt": f"This film is of {label_text}. My team: {program_name}. Opponent: {opp_name}.\n{focus_prompt or ''}",
            "interval_seconds": 12.0,   # one frame ~every 12s; chunked for long film
            "max_frames": 10,
            "include_audio": False,
            "_progress": _prog,
        }))
        text = result[0].text
        clip = db.get(models.GameReportClip, clip_id)
        if clip:
            clip.analysis_text = text
        job = db.get(models.GenerationJob, job_id)
        if job:
            job.status = "done"
            job.result_id = clip_id
        db.commit()
    except Exception as exc:
        clip = db.get(models.GameReportClip, clip_id)
        if clip:
            clip.analysis_text = f"Analysis failed — {str(exc)[:300]}"
        job = db.get(models.GenerationJob, job_id)
        if job:
            job.status = "error"
            job.error = str(exc)[:500]
        db.commit()
    finally:
        db.close()


def _run_clip_recorrection(clip_id: int, job_id: int, video_path: str, output_type: str,
                           program_name: str, opp_name: str, label_text: str,
                           coach_weight: int, prior_text: str, correction: str):
    """Background task: RE-WATCH the film guided by a coach correction. Instead of
    just rephrasing the old text, we re-run the vision analysis focused on the
    action the coach described so the model can LOCATE and VERIFY it in the film
    and fold the verified observation into a corrected analysis."""
    import asyncio
    db = SessionLocal()
    try:
        import sys
        sys.path.insert(0, ".")
        from video_vision.server import _handle_analyze_basketball_video

        def _prog(done, total, label):
            pdb = SessionLocal()
            try:
                j = pdb.get(models.GenerationJob, job_id)
                if j:
                    j.progress = label
                    pdb.commit()
            finally:
                pdb.close()

        focus = (
            f"This film is of {label_text}. My team: {program_name}. Opponent: {opp_name}.\n\n"
            "A coach reviewed your PRIOR analysis of this exact film and made a correction. "
            "Re-watch the film and LOCATE the specific action, play, or moment the coach is "
            "describing. VERIFY it visually in the frames — identify the concept/action they "
            "mean (a screen, a rotation, a coverage, a read, whoever was involved), cite it by "
            "film timestamp (MM:SS), and produce a CORRECTED analysis that integrates that "
            "verified observation. Do NOT simply repeat the coach's words — find what they are "
            "pointing at in the film and describe it accurately. If, after re-watching, you "
            "still cannot see what they describe, say so plainly rather than inventing it.\n\n"
            f"PRIOR ANALYSIS:\n{prior_text}\n\nCOACH CORRECTION:\n{correction}"
        )

        from ..storage import ensure_local
        result = asyncio.run(_handle_analyze_basketball_video({
            "video_path": ensure_local(video_path),
            "output_type": output_type,
            "program_name": program_name,
            "competition_level": "HS Varsity",
            "coach_weight": coach_weight,
            "player_name": label_text,
            "focus_prompt": focus,
            "interval_seconds": 8.0,   # denser sampling for a targeted re-watch
            "max_frames": 12,
            "include_audio": False,
            "_progress": _prog,
        }))
        clip = db.get(models.GameReportClip, clip_id)
        if clip:
            clip.analysis_text = result[0].text
        job = db.get(models.GenerationJob, job_id)
        if job:
            job.status = "done"
            job.result_id = clip_id
        db.commit()
    except Exception as exc:
        job = db.get(models.GenerationJob, job_id)
        if job:
            job.status = "error"
            job.error = str(exc)[:500]
        db.commit()
    finally:
        db.close()

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


@router.post("/{report_id}/clips")
async def add_clip(
    report_id: int,
    background_tasks: BackgroundTasks,
    label: str = Form(...),
    video: UploadFile = File(...),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")

    from ..storage import save_fileobj, StorageFullError
    from uuid import uuid4
    suffix = Path(video.filename or "clip.mp4").suffix
    try:
        dest = save_fileobj(video.file, f"gr_{report_id}_clip_{uuid4().hex}{suffix}")
    except StorageFullError:
        raise HTTPException(
            status_code=507,
            detail="The server is out of storage space. Free up disk space (or configure S3 storage) and try again.",
        )

    label_text = "my team" if label == "my_team" else "the opponent"
    my_team_name = gr.my_team.name if gr.my_team else coach.program_name
    opp_name = gr.opponent_team.name if gr.opponent_team else (gr.opponent_name or "Opponent")

    # Create the clip in an "analyzing" state (analysis_text=None) and run the
    # AI breakdown in the BACKGROUND so the upload request returns immediately —
    # long (up to hour-long) film no longer holds the connection open or hangs
    # the app. The client polls the report until analysis_text appears.
    clip = models.GameReportClip(
        game_report_id=report_id,
        video_path=str(dest),
        label=label,
        analysis_text=None,
    )
    db.add(clip)
    db.commit()
    db.refresh(clip)

    # A GenerationJob carries per-segment progress so the app shows the same
    # progress bar as the player-eval flow.
    job = models.GenerationJob(coach_id=coach.id, kind="clip", status="processing")
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        _run_clip_analysis, clip.id, job.id, str(dest), gr.output_type,
        my_team_name, opp_name, label_text, coach.weight, gr.focus_prompt or "",
    )
    return {"job_id": job.id, "clip_id": clip.id}


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
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    # Free the actual film file from storage, not just the DB row.
    if clip.video_path:
        from ..storage import delete as storage_delete
        storage_delete(clip.video_path)
    db.delete(clip)
    db.commit()
    return {"ok": True}


@router.get("/videos")
def game_report_videos(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Video catalog for the coach's game report packets — every film clip, with
    the report it's attached to and a stream url, like the player video catalog."""
    from ..storage import playback_url, exists
    reports = db.query(models.GameReport).filter_by(coach_id=coach.id).all()
    by_id = {r.id: r for r in reports}
    clips = (
        db.query(models.GameReportClip)
        .filter(models.GameReportClip.game_report_id.in_(list(by_id.keys()) or [0]))
        .order_by(models.GameReportClip.id.desc())
        .all()
    )
    out = []
    for c in clips:
        if not c.video_path or not exists(c.video_path):
            continue
        gr = by_id.get(c.game_report_id)
        title = (gr.title if gr and gr.title else None) or (
            (f"{gr.my_team.name if gr and gr.my_team else 'My Team'} vs "
             f"{(gr.opponent_team.name if gr and gr.opponent_team else (gr.opponent_name if gr else None)) or 'Opponent'}")
            if gr else "Game Report"
        )
        out.append({
            "id": c.id,
            "report_id": c.game_report_id,
            "report_title": title,
            "label": "My Team" if c.label == "my_team" else "Opponent",
            "created_at": c.created_at,
            "stream_url": playback_url(c.video_path, f"/game-reports/{c.game_report_id}/clips/{c.id}/stream"),
        })
    return out


@router.get("/{report_id}/clips/{clip_id}/stream")
def stream_clip(
    report_id: int,
    clip_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    from fastapi.responses import FileResponse
    from ..storage import exists, ensure_local
    clip = db.get(models.GameReportClip, clip_id)
    if not clip or clip.game_report_id != report_id:
        raise HTTPException(status_code=404, detail="Clip not found")
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    if not clip.video_path or not exists(clip.video_path):
        raise HTTPException(status_code=404, detail="Video file is no longer available")
    return FileResponse(ensure_local(clip.video_path), media_type="video/mp4")


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

    # For an Opponent-vs-Opponent report, both sides are opponents (two teams in
    # our division we may face) — my_team_id holds Opponent A, opponent side B.
    is_opp_vs_opp = gr.mode == "opp_vs_opp"
    team_a_name = my_team_name if not is_opp_vs_opp else (gr.my_team.name if gr.my_team else (gr.opponent_a_name or "Opponent A"))
    team_b_name = opp_name if not is_opp_vs_opp else (gr.opponent_team.name if gr.opponent_team else (gr.opponent_name or "Opponent B"))

    # Build matchup header
    if is_opp_vs_opp:
        matchup = f"{team_a_name} vs {team_b_name} (opponent-vs-opponent scouting)"
    elif gr.mode == "vs_opponent" and opp_name:
        matchup = f"{my_team_name} vs {opp_name}"
    elif gr.mode == "my_program":
        matchup = my_team_name
    else:
        matchup = opp_name or "Opponent"

    # Build roster context for my team
    my_roster_context = ""
    if gr.my_team_id and gr.mode in ("vs_opponent", "my_program", "opp_vs_opp"):
        players = db.query(models.Player).filter_by(team_id=gr.my_team_id).all()
        for p in players:
            name = f"#{p.jersey_number} {p.name}" if p.jersey_number else p.name
            parts = [name]
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
    if gr.opponent_team_id and gr.mode in ("vs_opponent", "opponent_only", "opp_vs_opp"):
        players = db.query(models.Player).filter_by(team_id=gr.opponent_team_id).all()
        for p in players:
            name = f"#{p.jersey_number} {p.name}" if p.jersey_number else p.name
            parts = [name]
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

    # Auto-include what we've already "remembered" about this opponent — the
    # coach's opponent notes and their most recent scouting report on them — so
    # the packet builds on the full knowledge base, not just this game's inputs.
    remembered = ""
    if opp_name:
        onotes = db.query(models.OpponentNote).filter_by(coach_id=coach.id, opponent_name=opp_name).all()
        if onotes:
            remembered += "\nREMEMBERED OPPONENT NOTES:\n" + "\n".join(f"- {n.note_text}" for n in onotes)
        opp_games = (
            db.query(models.GameSession)
            .filter_by(opponent_name=opp_name)
            .order_by(models.GameSession.id.desc())
            .all()
        )
        scout_added = game_added = False
        for g in opp_games:
            if not scout_added:
                row = db.query(models.GameScoutingReport).filter_by(game_id=g.id, coach_id=coach.id).first()
                if row and row.report_text:
                    remembered += f"\nPRIOR SCOUTING REPORT ON {opp_name}:\n{row.report_text}\n"
                    scout_added = True
            if not game_added:
                grow = db.query(models.GameFullReport).filter_by(game_id=g.id, coach_id=coach.id).first()
                if grow and grow.report_text:
                    remembered += f"\nPRIOR GAME REPORT vs {opp_name}:\n{grow.report_text}\n"
                    game_added = True
            if scout_added and game_added:
                break

    # Assemble prompt
    from video_vision.bim import describe_output_type, comprehensive_directive
    sections = [
        f"You are the BloomPrint Basketball Intelligence Model.",
        f"Generate a {describe_output_type(gr.output_type)} for: {matchup}",
        f"PROGRAM: {my_team_name}",
    ]
    if my_roster_context or opp_roster_context:
        sections.append(
            "\nWhen the film shows a jersey number, MAP IT to the matching player in the "
            "rosters below (each player is listed as '#<number> <name>') and refer to them by "
            "name. Do NOT claim a player is absent or unknown if their number appears on a "
            "roster below — use the roster as the source of truth for who is on the floor."
        )
    if is_opp_vs_opp:
        sections.append(
            f"\nThis is an OPPONENT-vs-OPPONENT scouting report: {team_a_name} and {team_b_name} are two "
            "teams we may face. Analyze BOTH teams, how they match up against each other, each team's "
            "strengths/weaknesses, key players, and how WE should prepare for either one."
        )
        if my_roster_context:
            sections.append(f"\n{team_a_name} ROSTER:\n{my_roster_context}")
        if opp_roster_context:
            sections.append(f"\n{team_b_name} ROSTER:\n{opp_roster_context}")
    else:
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
    if remembered:
        sections.append(f"\nKNOWLEDGE BASE ON {opp_name} (use as reference):{remembered}")
    if gr.focus_prompt:
        sections.append(f"\nFOCUS:\n{gr.focus_prompt}")

    if gr.output_type == "game_situational":
        sections.append(
            "\nGenerate a GAME SITUATIONAL REPORT. Analyze the film and produce a detailed report on: "
            "how the coach and team should read specific on-court actions, defensive sets and how to attack them, "
            "offensive actions and counters, opponent tendencies and how to exploit or defend them, "
            "situational responses (end of clock, press breaks, late-game, transition defense), "
            "and key adjustments to make."
            f"{REPORT_FORMAT_WITH_TABLES}"
        )
    else:
        sections.append(
            "\nProvide a comprehensive analysis using the BIM framework. "
            "Include strengths, weaknesses, key players, strategic recommendations."
            f"{REPORT_FORMAT_WITH_TABLES}"
        )

    directive = comprehensive_directive(gr.output_type)
    if directive:
        sections.append(directive)

    prompt = "\n".join(sections)

    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured on the server.")

    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model="claude-opus-4-7",
            max_tokens=16000,
            messages=[{"role": "user", "content": prompt}],
        )
        text_blocks = [b for b in response.content if hasattr(b, "text")]
        if not text_blocks:
            raise HTTPException(status_code=500, detail="AI returned no content")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    gr.report_text = text_blocks[0].text
    db.commit()
    db.refresh(gr)
    return _build_out(gr)


class TeamTrainingBody(BaseModel):
    focus_prompt: str | None = None


@router.post("/{report_id}/team-training", response_model=schemas.GameReportOut)
async def generate_team_training(
    report_id: int,
    body: TeamTrainingBody,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Generate a team training report based on game report film and eval data."""
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured.")

    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")

    my_team_name = gr.my_team.name if gr.my_team else coach.program_name

    # Build roster context
    roster_context = ""
    if gr.my_team_id:
        players = db.query(models.Player).filter_by(team_id=gr.my_team_id).all()
        for p in players:
            evals = p.evaluations
            grade_str = "N/A"
            latest_grade = None
            for ev in sorted(evals, key=lambda e: e.created_at, reverse=True):
                if ev.overall_grade is not None:
                    latest_grade = ev.overall_grade
                    break
            if latest_grade is not None:
                grade_str = f"{latest_grade:.1f}/10"
            flags = ", ".join((evals[-1].green_flags or [])[:3]) if evals else ""
            watch = ", ".join((evals[-1].watch_flags or [])[:3]) if evals else ""
            roster_context += (
                f"- {p.name} ({p.position or 'N/A'}, H:{p.height or 'N/A'}): "
                f"Grade {grade_str}. Strengths: {flags or 'N/A'}. Watch: {watch or 'N/A'}.\n"
            )

    # Build film context
    film_context = ""
    for clip in gr.clips:
        if clip.analysis_text:
            label_str = "My Team Film" if clip.label == "my_team" else "Opponent Film"
            film_context += f"\n{label_str.upper()}:\n{clip.analysis_text[:800]}\n"

    sections = [
        f"You are the BloomPrint Basketball Intelligence Model.",
        f"Generate a TEAM TRAINING PROGRAM for: {my_team_name}",
        f"PROGRAM: {my_team_name}",
    ]
    if roster_context:
        sections.append(f"\nROSTER DATA:\n{roster_context}")
    if film_context:
        sections.append(f"\nFILM ANALYSIS:{film_context}")
    if body.focus_prompt:
        sections.append(f"\nFOCUS:\n{body.focus_prompt}")

    sections.append(
        "\nGenerate a comprehensive team training program based on the film analysis and player eval data. "
        "Include: team strengths to build on, collective weaknesses to address, specific drills by position group, "
        "weekly practice structure, situational training scenarios, and individual focus areas for key players."
        f"{REPORT_FORMAT}"
    )

    prompt = "\n".join(sections)

    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model="claude-opus-4-7",
            max_tokens=16000,
            messages=[{"role": "user", "content": prompt}],
        )
        text_blocks = [b for b in response.content if hasattr(b, "text")]
        if not text_blocks:
            raise HTTPException(status_code=500, detail="AI returned no content")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    gr.report_text = text_blocks[0].text
    gr.output_type = "team_training"
    db.commit()
    db.refresh(gr)
    return _build_out(gr)


class GameReportCorrectBody(BaseModel):
    correction: str


@router.post("/{report_id}/clips/{clip_id}/correct")
async def correct_clip(
    report_id: int,
    clip_id: int,
    body: GameReportCorrectBody,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Re-watch the clip's film guided by the coach's correction (background job),
    so the model locates/verifies the described action and folds it in — rather
    than just rewording the old text. The client polls the returned job."""
    clip = db.get(models.GameReportClip, clip_id)
    if not clip or clip.game_report_id != report_id:
        raise HTTPException(status_code=404, detail="Clip not found")
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    if not clip.analysis_text:
        raise HTTPException(status_code=400, detail="No analysis to correct")

    label_text = "my team" if clip.label == "my_team" else "the opponent"
    my_team_name = gr.my_team.name if gr.my_team else coach.program_name
    opp_name = gr.opponent_team.name if gr.opponent_team else (gr.opponent_name or "Opponent")

    job = models.GenerationJob(coach_id=coach.id, kind="clip", status="processing")
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        _run_clip_recorrection, clip.id, job.id, clip.video_path, gr.output_type,
        my_team_name, opp_name, label_text, coach.weight, clip.analysis_text, body.correction,
    )
    return {"job_id": job.id, "clip_id": clip.id}


@router.post("/{report_id}/correct", response_model=schemas.GameReportOut)
async def correct_game_report(
    report_id: int,
    body: GameReportCorrectBody,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id or not gr.report_text:
        raise HTTPException(status_code=404, detail="Game report not found")

    prompt = (
        f"You are a basketball analysis expert. Below is a game report followed by a correction "
        f"from the coach. Update the report to incorporate this correction. "
        f"Return ONLY the updated report text in the same format.\n\n"
        f"ORIGINAL REPORT:\n{gr.report_text}\n\n"
        f"CORRECTION:\n{body.correction}\n\nUPDATED REPORT:"
    )
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model="claude-opus-4-7",
            max_tokens=16000,
            messages=[{"role": "user", "content": prompt}],
        )
        gr.report_text = response.content[0].text.strip()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Correction failed: {exc}")

    db.commit()
    db.refresh(gr)
    return _build_out(gr)


@router.get("/{report_id}/corrections")
def list_game_report_corrections(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    rows = (
        db.query(models.GameReportCorrection)
        .filter_by(game_report_id=report_id)
        .order_by(models.GameReportCorrection.id)
        .all()
    )
    return [
        {"id": c.id, "correction": c.correction, "applied": c.applied, "created_at": c.created_at}
        for c in rows
    ]


@router.post("/{report_id}/corrections")
def add_game_report_correction(
    report_id: int,
    body: GameReportCorrectBody,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Save a correction for later without regenerating."""
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    c = models.GameReportCorrection(game_report_id=report_id, coach_id=coach.id, correction=body.correction)
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id, "correction": c.correction, "applied": c.applied, "created_at": c.created_at}


@router.post("/{report_id}/regenerate", response_model=schemas.GameReportOut)
async def regenerate_game_report(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Regenerate the game report from all un-applied corrections, then mark
    those corrections applied."""
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id or not gr.report_text:
        raise HTTPException(status_code=404, detail="Game report not found")
    pending = (
        db.query(models.GameReportCorrection)
        .filter_by(game_report_id=report_id, applied=False)
        .order_by(models.GameReportCorrection.id)
        .all()
    )
    if not pending:
        raise HTTPException(status_code=400, detail="No un-applied corrections to apply")
    corrections_text = "\n".join(f"- {c.correction}" for c in pending)
    prompt = (
        f"You are a basketball analysis expert. Below is a game report followed by corrections "
        f"from the coach. Update the report to incorporate ALL of them. "
        f"Return ONLY the updated report text in the same format.\n\n"
        f"ORIGINAL REPORT:\n{gr.report_text}\n\n"
        f"CORRECTIONS:\n{corrections_text}\n\nUPDATED REPORT:"
    )
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model="claude-opus-4-7",
            max_tokens=16000,
            messages=[{"role": "user", "content": prompt}],
        )
        gr.report_text = response.content[0].text.strip()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Correction failed: {exc}")
    for c in pending:
        c.applied = True
    db.commit()
    db.refresh(gr)
    return _build_out(gr)
