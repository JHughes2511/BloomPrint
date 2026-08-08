import os
import re
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..auth import get_current_coach
from .. import genjob
from ..report_format import REPORT_FORMAT, REPORT_FORMAT_WITH_TABLES
from .. import models, notify, schemas
from ..ownership import get_owned
from ..report_sections import _without_sections
from ..ai_models import OPUS, SONNET, text_of, long_text

router = APIRouter(prefix="/training", tags=["training"])


class RegenerateRequest(BaseModel):
    feedback: str


def _title_for(program_text: str, priorities: list[str]) -> str | None:
    """A short subject line for a training program.

    Asks the model for one, because the program is the only thing that knows
    what it is actually about. Falls back to _derive_title, which reads the
    leading terms off the priorities — that fallback is what runs with no API
    key, on a failed call, and for programs written before titles existed, so
    it has to stand on its own rather than being a placeholder.

    SONNET rather than OPUS: naming text another model already reasoned about
    is a transformation, not analysis.
    """
    fallback = _derive_title(program_text, priorities)
    if not (program_text or "").strip():
        return fallback
    try:
        import anthropic

        client = anthropic.Anthropic()
        response = client.messages.create(
            model=SONNET,
            max_tokens=40,
            messages=[{
                "role": "user",
                "content": (
                    "Title this basketball training program in 3-6 words, naming the "
                    "skills it develops. It is a subject line in a list of programs for "
                    "one player, so it has to distinguish this program from others for "
                    "the same player. No quotes, no trailing punctuation, no player "
                    "name, no the word 'training'. Reply with the title only.\n\n"
                    + (program_text or "")[:4000]
                ),
            }],
        )
        title = (text_of(response) or "").strip().strip('"').strip()
        # One line, sane length, and actually words — otherwise take the fallback
        # rather than putting a refusal or a paragraph in the list.
        title = title.splitlines()[0].strip() if title else ""
        if 3 <= len(title) <= 60 and not title.endswith((".", ":")):
            return title
    except Exception:
        pass
    return fallback


def _derive_title(program_text: str, priorities: list[str]) -> str | None:
    """A short subject line for a training program.

    Built from the leading term of the first few priorities — "Shooting ·
    Ball security · Closeouts" — which is what a coach actually scans for when
    looking back through a player's programs. Falls back to the first real
    line of the brief, and finally to nothing, so the UI keeps its old label
    rather than inventing a wrong one.
    """
    import re as _re

    def head(item: str) -> str:
        # Keep the skill, drop the target: "Shooting: 5/10 makes" -> "Shooting"
        part = _re.split(r"[:\u2014\u2013(]|\s+-\s+", item, 1)[0].strip()
        return part[:34].strip(" .")

    heads = [h for h in (head(p) for p in (priorities or [])) if len(h) > 2]
    if heads:
        # dict.fromkeys keeps first-seen order while removing repeats
        return " · ".join(list(dict.fromkeys(heads))[:3])

    for raw in (program_text or "").splitlines():
        line = _re.sub(r"^[\s\-·•*#\d\.\)]+", "", raw).strip().rstrip(":").strip()
        # Skip section headers — they name the format, not the content
        if len(line) > 6 and not line.isupper():
            return line[:60].strip()
    return None


def _extract_priorities(program_text: str) -> list[str]:
    """Pull the ordered priority/KPI list out of a program, skipping headers and
    stray punctuation (e.g. a leftover ':' from the 'KPI TARGETS:' line)."""
    import re
    priorities: list[str] = []
    m = re.search(r"KPI TARGETS(.*?)(?:CORRECTABLE|PROGRESS|WEEKLY|$)", program_text, re.DOTALL | re.IGNORECASE)
    if not m:
        return priorities
    for raw in m.group(1).splitlines():
        # strip leading bullets/numbers/arrows AND leading colons/whitespace
        line = re.sub(r"^[\s\-·•*\d\.\):↑↓]+", "", raw).strip()
        line = line.rstrip(":").strip()
        if len(line) < 3 or not re.search(r"[A-Za-z]", line):
            continue
        priorities.append(line)
    return priorities[:6]


def _extract_reference(upload: "UploadFile") -> tuple[str, list[dict]]:
    """Turn an uploaded training-reference file into (text, media_blocks) that
    can be fed to the AI. Text-extractable formats (txt/csv/xlsx/docx) become
    text; images and PDFs become native content blocks for Claude. Best-effort:
    any failure yields empty results so generation still proceeds."""
    import base64
    name = (upload.filename or "").lower()
    try:
        data = upload.file.read()
    except Exception:
        return "", []
    if not data:
        return "", []

    ctype = (upload.content_type or "").lower()
    # Images → vision block
    if ctype.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        media = "image/png" if name.endswith(".png") else "image/webp" if name.endswith(".webp") else "image/gif" if name.endswith(".gif") else "image/jpeg"
        return "", [{"type": "image", "source": {"type": "base64", "media_type": media, "data": base64.b64encode(data).decode()}}]
    # PDF → native document block
    if ctype == "application/pdf" or name.endswith(".pdf"):
        return "", [{"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(data).decode()}}]
    # Plain text / CSV
    if name.endswith((".txt", ".csv", ".md")) or ctype.startswith("text/"):
        try:
            return data.decode("utf-8", errors="ignore")[:6000], []
        except Exception:
            return "", []
    # Excel
    if name.endswith((".xlsx", ".xls")) or "spreadsheet" in ctype:
        try:
            import io, openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            lines = []
            for ws in wb.worksheets:
                lines.append(f"# Sheet: {ws.title}")
                for row in ws.iter_rows(values_only=True):
                    cells = [str(c) for c in row if c is not None]
                    if cells:
                        lines.append(" | ".join(cells))
            return "\n".join(lines)[:6000], []
        except Exception:
            return "", []
    # Word
    if name.endswith(".docx") or "word" in ctype:
        try:
            import io, docx
            d = docx.Document(io.BytesIO(data))
            return "\n".join(p.text for p in d.paragraphs if p.text.strip())[:6000], []
        except Exception:
            return "", []
    # Unknown — try utf-8 as a last resort
    try:
        return data.decode("utf-8", errors="ignore")[:6000], []
    except Exception:
        return "", []


def build_player_training_prompt(player_name: str, original_text: str, feedback: str | None = None) -> str:
    """Recreate a coach's training program in the same rich, markdown-formatted
    style the player's own self-generated training programs use."""
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model. Generate a personalized, detailed training "
        f"program for {player_name} based on the following training program written by their coach.\n\n"
        f"COACH'S PROGRAM:\n{original_text[:4000]}\n\n"
    )
    if feedback:
        prompt += f"PLAYER FEEDBACK TO INCORPORATE:\n{feedback}\n\n"
    prompt += (
        "Create a detailed, actionable training program with specific drills, focus areas, and a weekly "
        "structure, preserving the coach's priorities and intent. Include a weekly plan broken out by day of "
        "the week (e.g. MONDAY, TUESDAY, WEDNESDAY, ...); put each day's title on its own line and list every "
        "drill/focus item under it as its own bullet starting with '- '."
        f"{REPORT_FORMAT}"
    )
    return prompt



def reformat_training_for_player(training_id: int, hide_sections: list[str] | None = None) -> None:
    """Background task: AI-restructure a coach's training into the player's
    checklist format. Runs after the send-to-player response is returned.

    `hide_sections` are headings the coach switched off when sending. They are
    dropped BEFORE the model sees the program, so a section the coach withheld
    cannot come back paraphrased in the player's copy."""
    db = SessionLocal()
    try:
        session = db.get(models.TrainingSession, training_id)
        if not session:
            return
        try:
            player_name = session.player.name if session.player else "the player"
            source = _without_sections(session.program_text or "", hide_sections or [])
            prompt = build_player_training_prompt(player_name, source)
            import anthropic
            client = anthropic.Anthropic()
            response = client.messages.create(
                model=OPUS,
                max_tokens=3000,
                messages=[{"role": "user", "content": prompt}],
            )
            session.player_program_text = text_of(response)
            session.completed_drills = []
        except Exception:
            pass
        session.reformatting = False
        db.commit()
    finally:
        db.close()


@router.post("")
def generate_training(
    player_id: int = Form(...),
    evaluation_id: int | None = Form(None),
    focus_prompt: str | None = Form(None),
    reference: UploadFile | None = File(None),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = get_owned(db, models.Player, player_id, coach.id, "Player")

    eval_record = None
    if evaluation_id:
        eval_record = get_owned(db, models.Evaluation, evaluation_id, coach.id, "Evaluation")
        if eval_record.player_id != player_id:
            raise HTTPException(status_code=404, detail="Evaluation not found for this player")

    # Optional coach-uploaded reference material (PDF/Word/txt/xlsx/csv/image).
    ref_text, ref_media = ("", [])
    if reference is not None and reference.filename:
        ref_text, ref_media = _extract_reference(reference)

    # Find latest overall_grade from player's evaluations
    evals_desc = sorted(player.evaluations, key=lambda e: e.created_at, reverse=True)
    latest_grade: float | None = None
    for ev in evals_desc:
        if ev.overall_grade is not None:
            latest_grade = ev.overall_grade
            break

    # Build context from ALL reports currently under the player, so the program
    # reflects the full evaluation picture — not just one report. The explicitly
    # selected evaluation (if any) is featured first and in full; the rest are
    # summarized (grade, strengths/watch flags, and a report excerpt).
    focus = focus_prompt or ""
    report_ctx_parts: list[str] = []
    if eval_record and eval_record.report_text:
        report_ctx_parts.append(
            f"PRIMARY EVALUATION (most recent / selected):\n{eval_record.report_text[:3000]}"
        )
    other_evals = [e for e in evals_desc if not (eval_record and e.id == eval_record.id)]
    for e in other_evals[:4]:
        if not (e.report_text or e.green_flags or e.watch_flags):
            continue
        grade_str = f"{e.overall_grade:.1f}/10" if e.overall_grade is not None else "N/A"
        strengths = ", ".join((e.green_flags or [])[:4]) or "N/A"
        watch = ", ".join((e.watch_flags or [])[:4]) or "N/A"
        date_str = e.created_at.strftime("%Y-%m-%d") if e.created_at else ""
        excerpt = (e.report_text or "")[:900]
        report_ctx_parts.append(
            f"ADDITIONAL EVALUATION ({e.output_type}, {date_str}) — Grade {grade_str}; "
            f"Strengths: {strengths}; Watch: {watch}.\n{excerpt}"
        )
    if report_ctx_parts:
        joined = "\n\n".join(report_ctx_parts)
        focus = f"Base this training program on ALL of the following reports for this player:\n\n{joined}\n\n{focus}"
    elif player.notes:
        focus = f"Player notes: {player.notes}\n\n{focus}"

    import sys
    sys.path.insert(0, ".")
    from video_vision.bim import build_prompt
    import anthropic

    from ..coach_context import resolve_level
    team = db.get(models.Team, player.team_id) if player.team_id else None
    prompt = build_prompt(
        "training_program",
        coach.program_name,
        resolve_level(coach, player, team),
        coach.weight,
        player.name,
    )
    # Explicitly include height and rating
    prompt += (
        f"\n\nPLAYER NAME: {player.name}"
        f"\nPLAYER METRICS:\nHEIGHT: {player.height or 'Not recorded'}"
        f"\nCURRENT RATING: {f'{latest_grade}/10' if latest_grade is not None else 'Not evaluated'}"
    )
    if focus:
        prompt += f"\n\nCOACH CONTEXT:\n{focus}"
    from ..coach_context import system_profile_block, focus_directive
    prompt += focus_directive(focus_prompt)
    prompt += system_profile_block(coach)
    if ref_text:
        prompt += (
            "\n\nCOACH-PROVIDED REFERENCE MATERIAL (incorporate its drills/structure "
            f"where relevant):\n{ref_text}"
        )
    if ref_media:
        prompt += (
            "\n\nThe coach also attached reference material as file(s) below — "
            "incorporate their drills/structure where relevant."
        )
    prompt += (
        f"\n\nAlways refer to the player by their name ({player.name}), not as 'the player' or a jersey number. "
        "Under each day of the WEEKLY SESSION PLAN, list every session item as its own bullet line. "
        # The player's app turns each day into a checkable row with the day as
        # the title and this focus as the line under it; a day written as the
        # bare word printed the day twice and told the player nothing.
        "Every day heading MUST carry its own short focus after the day name "
        "(e.g. 'MONDAY — Ball-handling under pressure + catch-and-shoot (45 min)'), "
        "never the day name alone."
        f"{REPORT_FORMAT}"
    )

    # If the coach attached an image/PDF, send it as content blocks alongside text.
    content: list[dict] = [{"type": "text", "text": prompt}]
    content.extend(ref_media)

    # Written on a job rather than on this request. Two reasons, and the second
    # is the worse one: a program takes longer than the app's request timeout, so
    # the coach was shown a failure for a program that was about to save — and
    # the call was made with the SYNCHRONOUS client inside an async endpoint,
    # which blocks the whole event loop while it runs. Every other coach's
    # request queued behind one training program being written.
    job = genjob.start(db, coach.id, "training", _training_payload(
        coach.id, player_id, evaluation_id, content, ref_media))
    background_tasks.add_task(
        _run_training_job, job.id, coach.id, player_id, evaluation_id, content)
    return {"job_id": job.id}


def _training_payload(coach_id, player_id, evaluation_id, content, ref_media) -> dict | None:
    """What a restarted server would need to write this program again.

    None when the coach attached a reference file: the attachment lives in the
    request, not in the database, and a resumed run without it would quietly be
    a different program from the one that was asked for. A job with no payload
    is closed with a reason the coach can act on instead — see revive_if_stalled.
    """
    if ref_media:
        return None
    return {"coach_id": coach_id, "player_id": player_id,
            "evaluation_id": evaluation_id, "content": content}


def _run_training_job(job_id: int, coach_id: int, player_id: int,
                      evaluation_id: int | None, content: list[dict]) -> None:
    import asyncio

    def work():
        program_text = asyncio.run(long_text(
            content, max_tokens=3000, on_words=genjob.words_reporter(job_id)))
        if not program_text.strip():
            raise RuntimeError("AI returned no content")
        priorities = _extract_priorities(program_text)
        db = SessionLocal()
        try:
            session = models.TrainingSession(
                player_id=player_id,
                coach_id=coach_id,
                evaluation_id=evaluation_id,
                program_text=program_text,
                priorities=priorities[:6],
                title=_title_for(program_text, priorities),
            )
            db.add(session)
            db.commit()
            db.refresh(session)
            return session.id
        finally:
            db.close()

    genjob.run(job_id, work)


class SendTrainingIn(BaseModel):
    # Section headings the coach switched off in the send sheet.
    hide_sections: list[str] = []


@router.post("/{training_id}/send-to-player")
def send_training_to_player(
    training_id: int,
    background_tasks: BackgroundTasks,
    body: SendTrainingIn | None = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Send a training session notification to the linked player user. The
    AI reformats it into the player's checklist format in the background —
    the coach's own program_text is never touched."""
    session = get_owned(db, models.TrainingSession, training_id, coach.id, "Training session")
    player = db.get(models.Player, session.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    if not player.player_user:
        raise HTTPException(status_code=400, detail="Player is not linked to a player account yet")
    notif = models.PlayerNotification(
        player_user_id=player.player_user.id,
        type="training_shared",
        title="Training Program Sent",
        body=f"{coach.name} sent you a training program. Check your training tab.",
        i18n_key="notifs.trainingSent", i18n_params={"coach": coach.name},
        ref_id=training_id,
    )
    db.add(notif)
    session.sent_to_player = True
    session.reformatting = True
    db.commit()
    notify.player_event(player.player_user, "training_assigned",
                        {"coach": coach.name,
                         "title": session.title or "Training program"})
    background_tasks.add_task(reformat_training_for_player, training_id,
                              list(body.hide_sections) if body else [])
    return {"ok": True, "player_name": player.name}


def _tc_out(c: "models.TrainingCorrection") -> dict:
    return {"id": c.id, "correction": c.correction, "applied": c.applied, "created_at": c.created_at}


@router.get("/{training_id}/corrections")
def coach_training_corrections(
    training_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    session = db.get(models.TrainingSession, training_id)
    if not session or session.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Training session not found")
    rows = (
        db.query(models.TrainingCorrection)
        .filter_by(training_session_id=training_id, coach_side=True)
        .order_by(models.TrainingCorrection.id)
        .all()
    )
    return [_tc_out(c) for c in rows]


@router.post("/{training_id}/corrections")
def add_coach_training_correction_row(
    training_id: int,
    body: schemas.PlayerCommentCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Save a coach correction for later without regenerating."""
    session = db.get(models.TrainingSession, training_id)
    if not session or session.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Training session not found")
    c = models.TrainingCorrection(training_session_id=training_id, correction=body.text, coach_side=True)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _tc_out(c)


@router.post("/{training_id}/apply-corrections", response_model=schemas.TrainingOut)
def apply_coach_training_corrections(
    training_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Regenerate the coach's program_text from all un-applied coach corrections."""
    session = db.get(models.TrainingSession, training_id)
    if not session or session.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Training session not found")
    pending = (
        db.query(models.TrainingCorrection)
        .filter_by(training_session_id=training_id, applied=False, coach_side=True)
        .order_by(models.TrainingCorrection.id)
        .all()
    )
    if not pending:
        raise HTTPException(status_code=400, detail="No un-applied corrections to apply")
    feedback = "\n".join(f"- {c.correction}" for c in pending)
    player_name = session.player.name if session.player else "the player"
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model.\n"
        f"Here is the current training program for {player_name}:\n\n{session.program_text or ''}\n\n"
        f"CORRECTIONS:\n{feedback}\n\n"
        "Update the training program incorporating ALL corrections. Keep the same structure but adjust "
        "focus areas, drills, and weekly plan."
        f"{REPORT_FORMAT}"
    )
    try:
        import anthropic
        client = anthropic.Anthropic()
        response = client.messages.create(
            model=OPUS,
            max_tokens=3000,
            messages=[{"role": "user", "content": prompt}],
        )
        session.program_text = text_of(response)
        session.priorities = _extract_priorities(session.program_text)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI update failed: {exc}")
    for c in pending:
        c.applied = True
    db.commit()
    db.refresh(session)
    out = schemas.TrainingOut.model_validate(session)
    out.player_name = session.player.name if session.player else None
    return out


@router.get("/{training_id}/comments", response_model=list[schemas.PlayerCommentOut])
def coach_training_comments(
    training_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    session = db.get(models.TrainingSession, training_id)
    if not session or session.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Training session not found")
    comments = (
        db.query(models.PlayerComment)
        .filter_by(training_session_id=training_id)
        .order_by(models.PlayerComment.id)
        .all()
    )
    result = []
    for c in comments:
        out = schemas.PlayerCommentOut.model_validate(c)
        out.author_name = c.player_user.name if c.player_user else (c.coach.name if c.coach else "Unknown")
        result.append(out)
    return result


@router.post("/{training_id}/comments", response_model=schemas.PlayerCommentOut)
def add_coach_training_comment(
    training_id: int,
    body: schemas.PlayerCommentCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    session = db.get(models.TrainingSession, training_id)
    if not session or session.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Training session not found")
    comment = models.PlayerComment(
        coach_id=coach.id,
        training_session_id=training_id,
        text=body.text,
    )
    db.add(comment)
    db.flush()
    if session.player and session.player.player_user:
        notif = models.PlayerNotification(
            player_user_id=session.player.player_user.id,
            type="training_shared",
            title="Coach Replied",
            body=f"{coach.name} commented on your training: \"{body.text[:80]}\"",
            i18n_key="notifs.coachRepliedTraining",
            i18n_params={"coach": coach.name, "text": body.text[:80]},
            ref_id=training_id,
        )
        db.add(notif)
    db.commit()
    db.refresh(comment)
    out = schemas.PlayerCommentOut.model_validate(comment)
    out.author_name = coach.name
    return out


@router.post("/{training_id}/refresh-player-program")
def refresh_player_program(
    training_id: int,
    body: RegenerateRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Coach-triggered update to the player's checklist version, incorporating
    feedback. The coach's own program_text is left untouched."""
    session = db.get(models.TrainingSession, training_id)
    if not session or session.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Training session not found")
    player_name = session.player.name if session.player else "the player"
    prompt = build_player_training_prompt(player_name, session.program_text or "", body.feedback)
    try:
        import anthropic
        client = anthropic.Anthropic()
        response = client.messages.create(
            model=OPUS,
            max_tokens=3000,
            messages=[{"role": "user", "content": prompt}],
        )
        session.player_program_text = text_of(response)
        session.completed_drills = []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI update failed: {exc}")
    if session.player and session.player.player_user:
        notif = models.PlayerNotification(
            player_user_id=session.player.player_user.id,
            type="training_shared",
            title="Training Program Updated",
            body=f"{coach.name} updated your training program.",
            i18n_key="notifs.trainingUpdatedByCoach", i18n_params={"coach": coach.name},
            ref_id=training_id,
        )
        db.add(notif)
    db.commit()
    db.refresh(session)
    return session


@router.get("/player/{player_id}")
def list_training(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    sessions = db.query(models.TrainingSession).filter_by(player_id=player_id).all()
    result = []
    for s in sessions:
        out = schemas.TrainingOut.model_validate(s)
        out.player_name = s.player.name if s.player else None
        result.append(out)
    return result


@router.get("/recent")
def recent_training(
    limit: int = 30,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Get recent training sessions generated by this coach."""
    sessions = (
        db.query(models.TrainingSession)
        .filter_by(coach_id=coach.id)
        .order_by(models.TrainingSession.id.desc())
        .limit(limit)
        .all()
    )
    result = []
    for s in sessions:
        out = schemas.TrainingOut.model_validate(s)
        out.player_name = s.player.name if s.player else None
        result.append(out)
    return result


@router.post("/players/{player_id}/regenerate", response_model=schemas.TrainingOut)
async def regenerate_training(
    player_id: int,
    body: RegenerateRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Regenerate training program with coach feedback, replacing the latest session."""
    player = get_owned(db, models.Player, player_id, coach.id, "Player")

    # Get the latest training session for this player
    latest = (
        db.query(models.TrainingSession)
        .filter_by(player_id=player_id)
        .order_by(models.TrainingSession.id.desc())
        .first()
    )

    # Find latest overall_grade
    latest_grade: float | None = None
    for ev in sorted(player.evaluations, key=lambda e: e.created_at, reverse=True):
        if ev.overall_grade is not None:
            latest_grade = ev.overall_grade
            break

    prior_text = latest.program_text if latest else "No prior program."

    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model.\n"
        f"Here is the current training program for {player.name}:\n\n"
        f"{prior_text[:3000]}\n\n"
        f"PLAYER METRICS:\n"
        f"HEIGHT: {player.height or 'Not recorded'}\n"
        f"CURRENT RATING: {f'{latest_grade}/10' if latest_grade is not None else 'Not evaluated'}\n\n"
        f"COACH FEEDBACK:\n{body.feedback}\n\n"
        "Update the training program incorporating the coach feedback. Keep the same structure but adjust focus areas, drills, and weekly plan based on the feedback."
        f"{REPORT_FORMAT}"
    )

    import anthropic
    client = anthropic.Anthropic()
    response = client.messages.create(
        model=OPUS,
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}],
    )
    program_text = text_of(response)
    priorities = _extract_priorities(program_text)

    # Always insert a new row so the new training appears as a separate entry
    # in the Training Programs list rather than overwriting the existing one.
    session = models.TrainingSession(
        player_id=player_id,
        coach_id=coach.id,
        evaluation_id=latest.evaluation_id if latest else None,
        program_text=program_text,
        priorities=priorities[:6],
        title=_title_for(program_text, priorities),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session
