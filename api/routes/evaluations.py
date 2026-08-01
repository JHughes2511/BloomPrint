import re
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..auth import get_current_coach
from .. import models, schemas
from ..softdelete import soft_delete
from ..ownership import get_owned
from ..ai_models import OPUS, text_of
from ..uploadguard import read_upload

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

router = APIRouter(prefix="/evaluations", tags=["evaluations"])


def _finalize_eval(db, *, player_id, coach, output_type, competition_level,
                   coach_notes, video_path, report_text, title=None):
    """Parse a report and persist the Evaluation row."""
    eval_record = models.Evaluation(
        player_id=player_id,
        coach_id=coach.id,
        output_type=output_type,
        title=title,
        competition_level=competition_level,
        coach_weight=coach.weight,
        coach_notes=coach_notes,
        video_path=video_path,
        report_text=report_text,
        overall_grade=_parse_grade(report_text),
        pillar_grades=_parse_pillar_grades(report_text),
        key_questions=_parse_list_section(report_text, "KEY QUESTIONS"),
        green_flags=_parse_list_section(report_text, "GREEN FLAGS"),
        watch_flags=_parse_list_section(report_text, "WATCH FLAGS"),
    )
    db.add(eval_record)
    db.commit()
    db.refresh(eval_record)
    return eval_record


def _run_eval_video_job(job_id: int, *, player_id: int, coach_id: int, output_type: str,
                        competition_level: str, coach_notes: str | None, combined_focus: str,
                        interval_seconds: float, max_frames: int, include_audio: bool,
                        video_paths: list[str], player_name: str, coach_program: str, coach_weight: int,
                        title: str | None = None):
    """Background task: analyze one or more films and create ONE evaluation. The
    client polls the job for completion, so nothing times out."""
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

        # Analysis needs real files — download any S3-backed refs to temp local.
        from ..storage import ensure_local
        local_paths = [ensure_local(r) for r in video_paths]
        result = asyncio.run(_handle_analyze_basketball_video({
            "video_paths": local_paths,
            "output_type": output_type,
            "program_name": coach_program,
            "competition_level": competition_level,
            "coach_weight": coach_weight,
            "player_name": player_name,
            "focus_prompt": combined_focus,
            "additional_focus": True,   # player eval → tailored ADDITIONAL FOCUS section
            "audio_auto": True,         # gauge during pre-scan whether audio is worth transcribing
            "include_audio": include_audio,
            "_progress": _prog,
        }))
        report_text = result[0].text
        coach = db.get(models.Coach, coach_id)
        eval_record = _finalize_eval(
            db, player_id=player_id, coach=coach, output_type=output_type,
            competition_level=competition_level, coach_notes=coach_notes,
            video_path=video_paths[0] if video_paths else None, report_text=report_text,
            title=title,
        )
        # Keep every film in the player's video catalog, linked to this eval.
        for vp in video_paths:
            db.add(models.PlayerVideo(player_id=player_id, coach_id=coach_id,
                                      video_path=vp, source_kind="eval", source_id=eval_record.id))
        job = db.get(models.GenerationJob, job_id)
        if job:
            job.status = "done"
            job.result_id = eval_record.id
            db.commit()
    except Exception as exc:
        job = db.get(models.GenerationJob, job_id)
        if job:
            job.status = "error"
            job.error = str(exc)[:500]
            db.commit()
    finally:
        db.close()


@router.post("/upload-video")
async def upload_eval_video(
    video: UploadFile = File(...),
    coach: models.Coach = Depends(get_current_coach),
):
    """Stream one film to durable storage and return a token. The eval is then
    submitted with a list of tokens so several films can build one eval."""
    from uuid import uuid4
    from ..storage import save_fileobj, StorageFullError
    suffix = Path(video.filename or "video.mp4").suffix
    name = f"evalvid_{coach.id}_{uuid4().hex}{suffix}"
    try:
        save_fileobj(video.file, name)
    except StorageFullError:
        raise HTTPException(
            status_code=507,
            detail="The server is out of storage space. Free up disk space (or configure S3 storage) and try again.",
        )
    return {"token": name}


@router.post("/extract-doc")
async def extract_doc_text(
    file: UploadFile = File(...),
    purpose: str = "coaching notes",
    coach: models.Coach = Depends(get_current_coach),
):
    """Extract clean text from ANY uploaded file (spreadsheet, PDF, Word, image/
    photo, text) so a coach can import notes or a focus prompt. Images/PDFs are
    transcribed by the model."""
    from .. import ai_import
    content = await read_upload(file, what='document')
    try:
        text = ai_import.ai_extract_text(content, file.filename or "", file.content_type, purpose)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not text:
        raise HTTPException(status_code=422, detail="No readable text was found in that file.")
    return {"text": text.strip()}


def _tokens_to_refs(tokens: str | None, coach_id: int) -> list[str]:
    """Validate upload tokens and resolve to storage refs. A token must be a bare
    filename owned by this coach (prefix guard), preventing traversal or reuse of
    another coach's upload."""
    from ..storage import ref_for, exists
    refs: list[str] = []
    for tok in (tokens or "").split(","):
        tok = tok.strip()
        if not tok or "/" in tok or "\\" in tok or ".." in tok:
            continue
        if not tok.startswith(f"evalvid_{coach_id}_"):
            continue
        ref = ref_for(tok)
        if exists(ref):
            refs.append(ref)
    return refs


def _gather_player_dossier(db, coach, player) -> str:
    """Everything the app knows about a player — for a MATCH-UP comparison. Pulls
    the player's own evals (grades, pillars, flags, latest report), training,
    tracked box-score stats, and any mention of them across the coach's game /
    team / scouting reports and the reports shared into their inbox."""
    from .game_eval import player_tracked_stats_block
    name = player.name
    lines = [f"=== {name} ==="]
    lines.append(
        f"Position: {player.position or 'N/A'} | Height: {player.height or 'N/A'} | "
        f"Level: {player.competition_level or 'N/A'}"
        + (f" | Team: {player.program_name}" if getattr(player, 'program_name', None) else "")
    )
    own = [e for e in player.evaluations if e.coach_id == coach.id] or list(player.evaluations)
    own = sorted(own, key=lambda e: e.id or 0, reverse=True)
    if own:
        latest = own[0]
        if latest.overall_grade is not None:
            lines.append(f"Latest BIM grade: {latest.overall_grade}/10 ({latest.output_type})")
        try:
            pg = ", ".join(f"{k}: {v}" for k, v in (latest.pillar_grades or {}).items())
            if pg:
                lines.append(f"Pillars: {pg}")
        except Exception:
            pass
        if latest.green_flags:
            lines.append("Green flags: " + "; ".join(str(x) for x in latest.green_flags[:4]))
        if latest.watch_flags:
            lines.append("Watch flags: " + "; ".join(str(x) for x in latest.watch_flags[:4]))
        lines.append(f"Evaluations on file: {len(own)}")
        if latest.report_text:
            lines.append("From latest report:\n" + latest.report_text[:900])
    else:
        lines.append("No evaluations on file for this subject.")
    tr = db.query(models.TrainingSession).filter_by(coach_id=coach.id, player_id=player.id).count()
    if tr:
        lines.append(f"Training programs on file: {tr}")
    game_ids = [g.id for g in db.query(models.GameSession).filter_by(coach_id=coach.id).all()]
    stats = player_tracked_stats_block(db, coach.id, name, game_ids) if game_ids else ""
    if stats and "No tracked" not in stats:
        lines.append(stats[:900])
    # Mentions across other reports (by name).
    mentions: list[str] = []

    def _grab(text, src):
        if text and name and name.lower() in text.lower() and len(mentions) < 6:
            idx = text.lower().find(name.lower())
            snippet = text[max(0, idx - 120):idx + 220].strip().replace("\n", " ")
            mentions.append(f"[{src}] …{snippet}…")

    for gr in db.query(models.GameReport).filter_by(coach_id=coach.id).limit(30).all():
        _grab(gr.report_text, "game report")
    for trp in db.query(models.TeamReport).filter_by(coach_id=coach.id).limit(30).all():
        _grab(trp.report_text, "team report")
    for gs in db.query(models.GameSession).filter_by(coach_id=coach.id).limit(40).all():
        _grab(getattr(gs, "ai_scouting_report", None), f"scouting vs {gs.opponent_name}")
    for sh in db.query(models.StaffSharedReport).filter_by(recipient_id=coach.id).limit(30).all():
        _grab(sh.frozen_text, "shared with you")
    if mentions:
        lines.append("Mentioned in other reports:\n" + "\n".join(mentions))
    return "\n".join(lines)


@router.post("")
async def submit_evaluation(
    background_tasks: BackgroundTasks,
    player_id: int = Form(...),
    output_type: str = Form(...),
    competition_level: str | None = Form(None),
    coach_notes: str | None = Form(None),
    focus_prompt: str | None = Form(None),
    interval_seconds: float = Form(5.0),
    max_frames: int = Form(10),
    include_audio: bool = Form(False),
    game_ids: str | None = Form(None),   # comma-separated tracked game ids (box score)
    matchup_player_ids: str | None = Form(None),  # comma-separated player ids to compare against
    video_tokens: str | None = Form(None),  # comma-separated tokens from /upload-video
    video: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = get_owned(db, models.Player, player_id, coach.id, "Player")

    # Frame the eval at the right competition level: the player's own level (which
    # itself defaults to their team's / the coach's), then the coach's signup level.
    from ..coach_context import resolve_level
    team = db.get(models.Team, player.team_id) if player.team_id else None
    competition_level = (competition_level or "").strip() or resolve_level(coach, player, team)

    # Get latest grade for this player (most recent non-null overall_grade)
    latest_grade: float | None = None
    for ev in sorted(player.evaluations, key=lambda e: e.created_at, reverse=True):
        if ev.overall_grade is not None:
            latest_grade = ev.overall_grade
            break

    # Build focus prompt combining coach notes + any explicit focus
    combined_focus = f"HEIGHT: {player.height or 'Not recorded'}\n"
    combined_focus += f"CURRENT RATING: {f'{latest_grade}/10' if latest_grade is not None else 'Not yet evaluated'}\n\n"
    if coach_notes:
        combined_focus += f"Coach notes:\n{coach_notes}\n\n"
    from ..coach_context import system_profile_block, focus_directive
    if focus_prompt:
        combined_focus += focus_directive(focus_prompt)
    # Attach real tracked box-score stats from selected games, if any.
    if game_ids:
        try:
            gid_list = [int(x) for x in game_ids.split(",") if x.strip()]
        except ValueError:
            gid_list = []
        if gid_list:
            from .game_eval import player_tracked_stats_block
            combined_focus += player_tracked_stats_block(db, coach.id, player.name, gid_list)
    combined_focus += system_profile_block(coach)

    # MATCH-UP: aggregate everything the app knows about each subject and hand it
    # to the model as the comparison material (works for film + text-only paths).
    from video_vision.bim import parse_output_types
    matchup_title: str | None = None
    if "matchup" in parse_output_types(output_type):
        ids = [int(x) for x in (matchup_player_ids or "").split(",") if x.strip().isdigit()]
        others = [db.get(models.Player, i) for i in ids]
        subjects = [player] + [p for p in others if p and p.id != player.id]
        names = " vs ".join(p.name for p in subjects)
        matchup_title = names
        dossiers = "\n\n".join(_gather_player_dossier(db, coach, p) for p in subjects)
        combined_focus += (
            f"\n\nMATCH-UP SUBJECTS — {names}. Compare these subjects head-to-head using ONLY the data "
            f"below. Compare them AS THEY ARE (do not normalize across competition levels); flag any "
            f"level gap and, if a subject's data is thin, note the confidence gap. "
            + ("(Only one subject was given — describe how they would match up against a typical "
               "opponent at their level.)\n\n" if len(subjects) < 2 else "\n\n")
            + dossiers
        )

    # Collect film: pre-uploaded tokens (multiple) and/or one direct file (legacy).
    from ..storage import save_fileobj
    from uuid import uuid4
    video_paths = _tokens_to_refs(video_tokens, coach.id)
    if video and video.filename:
        suffix = Path(video.filename or "video.mp4").suffix
        ref = save_fileobj(video.file, f"eval_{player_id}_{coach.id}_{uuid4().hex}{suffix}")
        video_paths.append(ref)

    if video_paths:
        # Process in the BACKGROUND so long/multiple film doesn't time out; the
        # client polls the job.
        job = models.GenerationJob(coach_id=coach.id, kind="eval", status="processing")
        db.add(job)
        db.commit()
        db.refresh(job)
        background_tasks.add_task(
            _run_eval_video_job, job.id,
            player_id=player_id, coach_id=coach.id, output_type=output_type,
            competition_level=competition_level, coach_notes=coach_notes,
            combined_focus=combined_focus, interval_seconds=interval_seconds,
            max_frames=max_frames, include_audio=include_audio, video_paths=video_paths,
            player_name=player.name, coach_program=coach.program_name, coach_weight=coach.weight,
            title=matchup_title,
        )
        return {"job_id": job.id, "status": "processing"}

    # No video provided — generate a text-only evaluation from coach notes (fast, synchronous).
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not set on the server. Ask the server admin to configure it."
        )
    from video_vision.bim import build_prompt
    from video_vision.bim import additional_focus_directive
    bim_prompt = build_prompt(output_type, coach.program_name, competition_level, coach.weight, player.name)
    bim_prompt += additional_focus_directive(combined_focus)

    import anthropic
    client = anthropic.AsyncAnthropic()
    response = await client.messages.create(
        model=OPUS,
        max_tokens=16000,
        messages=[{"role": "user", "content": bim_prompt}],
    )
    report_text = text_of(response)
    eval_record = _finalize_eval(
        db, player_id=player_id, coach=coach, output_type=output_type,
        competition_level=competition_level, coach_notes=coach_notes,
        video_path=None, report_text=report_text, title=matchup_title,
    )
    return schemas.EvalOut.model_validate(eval_record)


@router.get("/jobs/{job_id}")
def get_generation_job(
    job_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Poll a background generation job. When done, returns result_id."""
    job = db.get(models.GenerationJob, job_id)
    if not job or job.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Job not found")
    out = {"id": job.id, "kind": job.kind, "status": job.status,
           "result_id": job.result_id, "error": job.error, "progress": job.progress, "result": None}
    if job.status == "done" and job.result_id:
        if job.kind == "eval":
            ev = db.get(models.Evaluation, job.result_id)
            if ev:
                out["result"] = schemas.EvalOut.model_validate(ev).model_dump(mode="json")
        elif job.kind == "team_report":
            tr = db.get(models.TeamReport, job.result_id)
            if tr:
                out["result"] = schemas.TeamReportOut.model_validate(tr).model_dump(mode="json")
    return out


@router.get("/recent", response_model=list[schemas.EvalWithPlayerOut])
def recent_evaluations(
    limit: int = 30,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    # Only the coach's OWN evaluations. Reports shared with the coach surface
    # separately via the staff-sharing inbox (merged into Recent client-side).
    evals = (
        db.query(models.Evaluation)
        .filter_by(coach_id=coach.id)
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


def _build_team_report_prompt(output_type, team_label, roster_context, focus, video_context, system_block="", level="HS Varsity"):
    if output_type == "game_situational":
        type_instruction = (
            "Generate a GAME SITUATIONAL REPORT. Analyze the roster and provide a detailed report on: "
            "how the coach and team should read specific on-court actions, defensive sets and how to attack them, "
            "offensive actions and counters, player tendency exploitation, "
            "situational responses (end of clock, press breaks, late-game, transition defense), "
            "and key lineup adjustments for game situations."
        )
    else:
        from video_vision.bim import describe_output_type, comprehensive_directive
        type_instruction = (
            f"Generate a {describe_output_type(output_type)} for the {team_label} roster. "
            "Provide a comprehensive team analysis covering overall team grade, team strengths, "
            "areas to develop, lineup recommendations, and strategic priorities. "
            "Use the BIM framework with 6 pillars."
            f"{comprehensive_directive(output_type)}"
        )
    from ..coach_context import focus_directive
    return (
        f"You are the BloomPrint Basketball Intelligence Model. {type_instruction}\n\n"
        f"PROGRAM: {team_label}\n"
        f"COMPETITION LEVEL: {level} — calibrate every grade, expectation, comparison, and "
        f"recommendation to this level.\n\n"
        f"ROSTER SUMMARY:\n{roster_context}\n\n"
        f"{focus_directive(focus)}"
        f"{video_context}"
        f"{system_block}\n\n"
        "IMPORTANT: Do NOT use ## headers, ** bold markers, or ——— / === / --- dividers. "
        "Use plain section titles in ALL CAPS followed by a colon and newline. "
        "Example: OFFENSIVE TENDENCIES: followed by content."
    )


def _run_team_report_job(job_id: int, *, coach_id: int, output_type: str, focus_prompt: str | None,
                         team_label: str, roster_context: str, video_path: str,
                         coach_program: str, coach_weight: int, system_block: str = "",
                         coach_level: str = "HS Varsity"):
    """Background task: analyze a (potentially long) film for a team report and
    generate the report. The client polls the job."""
    import asyncio
    db = SessionLocal()
    try:
        video_context = ""
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
            vid_result = asyncio.run(_handle_analyze_basketball_video({
                "video_path": ensure_local(video_path),
                "output_type": output_type,
                "program_name": coach_program,
                "competition_level": coach_level,
                "coach_weight": coach_weight,
                "player_name": "Team",
                "focus_prompt": focus_prompt or "",
                "interval_seconds": 12.0,
                "max_frames": 8,
                "include_audio": False,
                "_progress": _prog,
            }))
            video_context = f"\n\nVIDEO ANALYSIS:\n{vid_result[0].text}\n"
        except Exception as exc:
            import logging
            logging.getLogger("bloomprint").warning("team_report video analysis skipped: %s", exc)

        prompt = _build_team_report_prompt(output_type, team_label, roster_context, focus_prompt or "", video_context, system_block, level=coach_level)
        import anthropic
        client = anthropic.Anthropic()
        response = client.messages.create(
            model=OPUS,
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        text_blocks = [b for b in response.content if hasattr(b, "text")]
        report_text = text_blocks[0].text if text_blocks else ""
        rec = models.TeamReport(coach_id=coach_id, output_type=output_type,
                                focus_prompt=focus_prompt, report_text=report_text)
        db.add(rec)
        db.commit()
        db.refresh(rec)
        job = db.get(models.GenerationJob, job_id)
        if job:
            job.status = "done"
            job.result_id = rec.id
            db.commit()
    except Exception as exc:
        job = db.get(models.GenerationJob, job_id)
        if job:
            job.status = "error"
            job.error = str(exc)[:500]
            db.commit()
    finally:
        db.close()


@router.post("/team-report")
async def team_report(
    background_tasks: BackgroundTasks,
    output_type: str = Form("coaching_report"),
    focus_prompt: str | None = Form(None),
    team_id: int | None = Form(None),
    # The other side of a match-up. Only meaningful when 'matchup' is among the
    # output types; ignored otherwise so the field can be sent unconditionally.
    opponent_team_id: int | None = Form(None),
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
    # Scoped to the caller. Without the coach filter a roster-wide team report
    # pulled every player in the database — one coach's report describing
    # another coach's players, by name, with their grades and flags. The
    # team_id filter alone did not save it: it was also unvalidated, so passing
    # someone else's team id returned their roster.
    query = db.query(models.Player).filter(models.Player.coach_id == coach.id)
    if team_id is not None:
        get_owned(db, models.Team, team_id, coach.id, "Team")
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

    team_label = coach.program_name
    team_obj = None
    if team_id is not None:
        team_obj = get_owned(db, models.Team, team_id, coach.id, "Team")
        if team_obj:
            team_label = f"{team_obj.name} ({coach.program_name})"

    # MATCH-UP: a second roster to compare against. Built from the same owned
    # data as the first, so a match-up cannot become a way to read a roster the
    # caller could not otherwise see.
    from video_vision.bim import parse_output_types
    if "matchup" in parse_output_types(output_type) and opponent_team_id is not None:
        opp = get_owned(db, models.Team, opponent_team_id, coach.id, "Team")
        opp_players = (
            db.query(models.Player)
            .filter(models.Player.coach_id == coach.id, models.Player.team_id == opp.id)
            .all()
        )
        if opp_players:
            roster_context += f"\n--- OPPONENT ROSTER: {opp.name} ---\n"
            for p in opp_players:
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
            team_label = f"{team_label} vs {opp.name}"

    from ..coach_context import system_profile_block, resolve_level
    system_block = system_profile_block(coach)
    team_level = resolve_level(coach, team=team_obj)

    if video and video.filename:
        # Long film → save to durable storage and process in the background.
        from ..storage import save_fileobj
        from uuid import uuid4
        suffix = Path(video.filename).suffix
        vid_ref = save_fileobj(video.file, f"team_report_{coach.id}_{uuid4().hex}{suffix}")
        job = models.GenerationJob(coach_id=coach.id, kind="team_report", status="processing")
        db.add(job)
        db.commit()
        db.refresh(job)
        background_tasks.add_task(
            _run_team_report_job, job.id,
            coach_id=coach.id, output_type=output_type, focus_prompt=focus_prompt,
            team_label=team_label, roster_context=roster_context, video_path=vid_ref,
            coach_program=coach.program_name, coach_weight=coach.weight, system_block=system_block,
            coach_level=team_level,
        )
        return {"job_id": job.id, "status": "processing"}

    # No video — generate synchronously (fast).
    prompt = _build_team_report_prompt(output_type, team_label, roster_context, focus_prompt or "", "", system_block, level=team_level)
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model=OPUS,
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
        db.refresh(team_report_record)
        return schemas.TeamReportOut.model_validate(team_report_record)
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
    ev = get_owned(db, models.Evaluation, eval_id, coach.id, "Evaluation")
    _backfill_parsed(db, ev)
    return ev


@router.delete("/{eval_id}")
def delete_evaluation(
    eval_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    ev = get_owned(db, models.Evaluation, eval_id, coach.id, "Evaluation")
    soft_delete(db, ev)
    db.commit()
    return {"ok": True}


@router.delete("/team-reports/{report_id}")
def delete_team_report(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    tr = get_owned(db, models.TeamReport, report_id, coach.id, "Team report")
    soft_delete(db, tr)
    db.commit()
    return {"ok": True}


class TeamReportCorrectionCreate(BaseModel):
    correction: str


@router.post("/team-reports/{report_id}/corrections", response_model=schemas.TeamReportCorrectionOut)
def add_team_report_correction(
    report_id: int,
    body: TeamReportCorrectionCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    get_owned(db, models.TeamReport, report_id, coach.id, "Team report")
    c = models.TeamReportCorrection(
        team_report_id=report_id,
        coach_id=coach.id,
        correction=body.correction,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.get("/team-reports/{report_id}/corrections", response_model=list[schemas.TeamReportCorrectionOut])
def list_team_report_corrections(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    return db.query(models.TeamReportCorrection).filter_by(team_report_id=report_id).all()


@router.post("/team-reports/{report_id}/regenerate", response_model=schemas.TeamReportOut)
async def regenerate_team_report(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    tr = get_owned(db, models.TeamReport, report_id, coach.id, "Team report")
    if not tr.report_text:
        raise HTTPException(status_code=404, detail="Team report not found")
    corrections = db.query(models.TeamReportCorrection).filter_by(team_report_id=report_id, applied=False).all()
    if not corrections:
        return tr

    corrections_text = "\n".join(f"- {c.correction}" for c in corrections)
    prompt = (
        f"You are a basketball analysis expert. Below is a team report followed by corrections from the coach. "
        f"Update the report to incorporate these corrections. Return ONLY the updated report text in the same format.\n\n"
        f"Do NOT use ## headers, ** bold markers, or ——— / === / --- dividers. "
        f"Use plain section titles in ALL CAPS followed by a colon and newline.\n\n"
        f"ORIGINAL REPORT:\n{tr.report_text}\n\n"
        f"CORRECTIONS:\n{corrections_text}\n\nUPDATED REPORT:"
    )
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model=OPUS,
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        text_blocks = [b for b in response.content if hasattr(b, "text")]
        if not text_blocks:
            raise HTTPException(status_code=500, detail="AI returned no content")
        tr.report_text = text_blocks[0].text.strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    for c in corrections:
        c.applied = True
    db.commit()
    db.refresh(tr)
    return tr


class TeamReportCorrectBody(BaseModel):
    correction: str


@router.post("/team-reports/{report_id}/correct", response_model=schemas.TeamReportOut)
async def correct_team_report(
    report_id: int,
    body: TeamReportCorrectBody,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    tr = get_owned(db, models.TeamReport, report_id, coach.id, "Team report")
    if not tr.report_text:
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
        model=OPUS,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    tr.report_text = text_of(response).strip()
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
    get_owned(db, models.Evaluation, eval_id, coach.id, "Evaluation")
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


@router.post("/{eval_id}/regenerate", response_model=schemas.EvalOut)
async def regenerate_evaluation(
    eval_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Re-run AI with all unapplied corrections, update the eval in-place, mark corrections applied."""
    ev = get_owned(db, models.Evaluation, eval_id, coach.id, "Evaluation")
    corrections = db.query(models.Correction).filter_by(evaluation_id=eval_id, applied=False).all()
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
        f"Do NOT use ## headers, ** bold markers, or ——— / === / --- dividers. "
        f"Use plain section titles in ALL CAPS followed by a colon and newline.\n\n"
        f"ORIGINAL REPORT:\n{ev.report_text}\n\n"
        f"CORRECTIONS:\n{corrections_text}\n\n"
        f"UPDATED REPORT:"
    )

    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model=OPUS,
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        text_blocks = [b for b in response.content if hasattr(b, "text")]
        if not text_blocks:
            raise HTTPException(status_code=500, detail="AI returned no content")
        updated_text = text_blocks[0].text.strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    ev.report_text = updated_text
    # Re-parse grades/flags from new text
    new_grade = _parse_grade(updated_text)
    new_pillars = _parse_pillar_grades(updated_text)
    new_green = _parse_list_section(updated_text, "GREEN FLAGS")
    new_watch = _parse_list_section(updated_text, "WATCH FLAGS")
    if new_grade is not None:
        ev.overall_grade = new_grade
    if new_pillars:
        ev.pillar_grades = new_pillars
    if new_green:
        ev.green_flags = new_green
    if new_watch:
        ev.watch_flags = new_watch

    # Mark all unapplied corrections as applied
    for c in corrections:
        c.applied = True

    db.commit()
    db.refresh(ev)
    return ev


@router.post("/{eval_id}/apply-corrections", response_model=schemas.EvalOut)
async def apply_corrections(
    eval_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    ev = get_owned(db, models.Evaluation, eval_id, coach.id, "Evaluation")
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
        f"FORMATTING RULES: Do NOT use any markdown. No ##, no **, no ---, no ===, no ——— dividers. "
        f"Use plain text only. Section headers in ALL CAPS followed by a colon and blank line.\n\n"
        f"ORIGINAL REPORT:\n{ev.report_text}\n\n"
        f"CORRECTIONS:\n{corrections_text}\n\n"
        f"UPDATED REPORT:"
    )

    import anthropic
    client = anthropic.Anthropic()
    response = client.messages.create(
        model=OPUS,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    updated_text = text_of(response).strip()

    ev.report_text = updated_text
    db.commit()
    db.refresh(ev)
    return ev


# ── Parsing helpers ────────────────────────────────────────────────────────────

# Everything the model puts between a "GRADE" label and the number itself:
# markdown bold, a colon, brackets or parens. "**OVERALL GRADE:** [8.5 / 10]"
# and "OVERALL GRADE 8.5/10" both have to parse — a miss here silently drops
# the eval out of the BIM composite, and nothing surfaces the failure.
_GRADE_GAP = r"[\s:\*_\[\(\-–—]*"
_OUT_OF_TEN = r"\s*(?:/|out\s+of)\s*10"


def _grade_value(m: re.Match) -> float | None:
    """A grade only counts if it is on the 0-10 scale the app grades against."""
    try:
        v = float(m.group(1))
    except (TypeError, ValueError):
        return None
    return v if 0.0 <= v <= 10.0 else None


def _parse_grade(text: str) -> float | None:
    if not text:
        return None
    m = re.search(rf"OVERALL GRADE{_GRADE_GAP}(\d+(?:\.\d+)?){_OUT_OF_TEN}", text, re.IGNORECASE)
    if m:
        return _grade_value(m)
    # Some reports write the scale only in the header ("OVERALL GRADE: 8.5").
    m = re.search(rf"OVERALL GRADE{_GRADE_GAP}(\d+(?:\.\d+)?)", text, re.IGNORECASE)
    return _grade_value(m) if m else None


def _parse_pillar_grades(text: str) -> dict:
    """Map each PILLAR heading to its grade.

    The search for a pillar's grade stops at the next PILLAR heading, so a
    pillar the model left ungraded can't silently borrow the following
    pillar's number.
    """
    if not text:
        return {}
    grades: dict[str, float] = {}
    heads = list(re.finditer(r"PILLAR\s+\d+[^:\n]*:\s*(.+)", text, re.IGNORECASE))
    for i, h in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        block = text[h.end():end]
        m = (re.search(rf"GRADE{_GRADE_GAP}(\d+(?:\.\d+)?){_OUT_OF_TEN}", block, re.IGNORECASE)
             or re.search(rf"GRADE{_GRADE_GAP}(\d+(?:\.\d+)?)", block, re.IGNORECASE))
        if not m:
            continue
        val = _grade_value(m)
        if val is None:
            continue
        name = _strip_md(h.group(1)).strip().lower().replace(" ", "_").replace("·", "").strip("_")
        if name:
            grades[name] = val
    return grades


def _parse_list_section(text: str, section: str) -> list[str]:
    """Extract a section (GREEN FLAGS, WATCH FLAGS, KEY QUESTIONS, …) as a list of
    items. Handles BOTH shapes the model produces: bulleted lines under the header,
    AND an inline paragraph on the same line ("GREEN FLAGS: point one. point two.")
    — the latter is split into items by sentence."""
    # Capture everything after the header (inline or on following lines) up to
    # the next section header, or end of text.
    #
    # The lookahead has to recognise a header in every shape the model emits,
    # because if it fails to, this section silently absorbs the rest of the
    # report. That is not a subtle formatting issue: GREEN FLAGS ends up holding
    # the watch flags, the key questions and the stat lines, so the UI shows a
    # player's problems listed as things they do well.
    #
    #   GREEN FLAGS          plain, no colon    <- the old pattern missed this
    #   **WATCH FLAGS**      markdown bold      <- and this
    #   KEY QUESTIONS:       colon              <- only this one worked
    #
    # The uppercase run is matched case-sensitively via (?-i:...) even though
    # the section name itself is matched case-insensitively. With IGNORECASE
    # applied throughout, "ALL-CAPS header" matches any capitalised phrase, so
    # an ordinary line like "Next 6 months: ..." reads as a header and truncates
    # the section early — the opposite failure, equally wrong.
    # A header is an uppercase run that either ends its line ("GREEN FLAGS") or
    # is followed by a colon and its content ("GREEN FLAGS: point one."). Both
    # shapes appear in real reports, and matching only the first let the inline
    # form run straight through the next header.
    header = (
        r"(?:\*{1,2}|#{1,6}\s*)?"                       # optional markdown
        r"(?-i:[A-Z][A-Z0-9 /&'()\-]{3,})"               # genuinely upper-case
        r"(?:\*{1,2})?\s*"                              # optional closing markdown
        r"(?::|(?=\n|$))"                                # colon, or end of line
    )
    pattern = rf"{re.escape(section)}\s*:?\s*(.*?)(?=\n\s*{header}|\Z)"
    m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    if not m:
        return []
    block = m.group(1).strip()
    if not block:
        return []
    # Bulleted form: keep only real list lines.
    bullets = [
        _strip_md(re.sub(r"^[-·*•\d\.\)\s]+", "", l)).strip()
        for l in block.splitlines()
        if re.match(r"^\s*(?:[-·*•]|\d+[.\)])\s+", l)
    ]
    bullets = [b for b in bullets if b]
    if bullets:
        return bullets
    # Inline paragraph form: collapse to one line and split into sentences.
    para = _strip_md(" ".join(l.strip() for l in block.splitlines() if l.strip()))
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])", para)
    return [p.strip() for p in parts if p.strip()]


def _backfill_parsed(db, ev, persist: bool = False) -> None:
    """Fill green/watch/questions from report_text when an older, stricter
    parser left them empty.

    Called from read paths, so it does not commit by default: a GET that writes
    turns every list request into N transactions and can fail the read outright
    if the write does. The values are filled on the in-memory object for the
    response; the one-time pass in init_db() persists them.
    """
    if not ev or not ev.report_text:
        return
    changed = False
    if not ev.green_flags:
        g = _parse_list_section(ev.report_text, "GREEN FLAGS")
        if g:
            ev.green_flags = g; changed = True
    if not ev.watch_flags:
        w = _parse_list_section(ev.report_text, "WATCH FLAGS")
        if w:
            ev.watch_flags = w; changed = True
    if not ev.key_questions:
        q = _parse_list_section(ev.report_text, "KEY QUESTIONS")
        if q:
            ev.key_questions = q; changed = True
    if changed and persist:
        try:
            db.commit()
        except Exception:
            db.rollback()


def _strip_md(s: str) -> str:
    """Remove stray markdown (** bold, ## headers, __) from plain-text reports."""
    if not s:
        return s
    s = re.sub(r"\*\*|__", "", s)          # bold markers
    # Single-asterisk italics too. Without this, lines the model writes as
    # "Shooting: 5/10 *(placeholder)*" reach the UI with the asterisks intact
    # and read as part of the grade. Only paired markers around non-space text
    # are removed, so a literal "3 * 4" or a trailing footnote star survives.
    s = re.sub(r"\*(?=\S)([^*\n]*?)(?<=\S)\*", r"\1", s)
    s = re.sub(r"_(?=\S)([^_\n]*?)(?<=\S)_", r"\1", s)
    s = re.sub(r"^\s*#{1,6}\s*", "", s)    # leading heading hashes
    s = s.replace("##", "")                 # any stray hashes
    return s
