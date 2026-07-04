import os
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..auth import get_current_coach
from .. import models, schemas

router = APIRouter(prefix="/training", tags=["training"])


class RegenerateRequest(BaseModel):
    feedback: str


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
        "structure, preserving the coach's priorities and intent. Format with clear sections, headers, and "
        "tables where useful. Include a weekly plan broken out by day of the week (e.g. MONDAY, TUESDAY, "
        "WEDNESDAY, ...) so each day's focus and drills can be tracked as a checklist."
    )
    return prompt


def reformat_training_for_player(training_id: int) -> None:
    """Background task: AI-restructure a coach's training into the player's
    checklist format. Runs after the send-to-player response is returned."""
    db = SessionLocal()
    try:
        session = db.get(models.TrainingSession, training_id)
        if not session:
            return
        try:
            player_name = session.player.name if session.player else "the player"
            prompt = build_player_training_prompt(player_name, session.program_text or "")
            import anthropic
            client = anthropic.Anthropic()
            response = client.messages.create(
                model="claude-opus-4-7",
                max_tokens=3000,
                messages=[{"role": "user", "content": prompt}],
            )
            session.player_program_text = response.content[0].text
            session.completed_drills = []
        except Exception:
            pass
        session.reformatting = False
        db.commit()
    finally:
        db.close()


@router.post("", response_model=schemas.TrainingOut)
async def generate_training(
    body: schemas.TrainingRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, body.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    eval_record = None
    if body.evaluation_id:
        eval_record = db.get(models.Evaluation, body.evaluation_id)
        if not eval_record or eval_record.player_id != body.player_id:
            raise HTTPException(status_code=404, detail="Evaluation not found for this player")

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
    focus = body.focus_prompt or ""
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

    prompt = build_prompt(
        "training_program",
        coach.program_name,
        player.competition_level,
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
    prompt += (
        "\n\nIMPORTANT FORMATTING: Do NOT use ## headers, ** bold markers, or ——— / === / --- dividers. "
        f"Always refer to the player by their name ({player.name}), not as 'the player' or a jersey number. "
        "Use plain section titles in ALL CAPS followed by a colon and newline."
    )

    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}],
    )
    program_text = response.content[0].text

    # Extract ordered priorities from the program text
    import re
    priorities: list[str] = []
    m = re.search(r"KPI TARGETS(.*?)(?:CORRECTABLE|PROGRESS|$)", program_text, re.DOTALL | re.IGNORECASE)
    if m:
        for line in m.group(1).splitlines():
            line = re.sub(r"^[-·*\d\.\s↑↓]+", "", line).strip()
            if line:
                priorities.append(line)

    session = models.TrainingSession(
        player_id=body.player_id,
        coach_id=coach.id,
        evaluation_id=body.evaluation_id,
        program_text=program_text,
        priorities=priorities[:6],
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{training_id}/send-to-player")
def send_training_to_player(
    training_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Send a training session notification to the linked player user. The
    AI reformats it into the player's checklist format in the background —
    the coach's own program_text is never touched."""
    session = db.get(models.TrainingSession, training_id)
    if not session:
        raise HTTPException(status_code=404, detail="Training session not found")
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
        ref_id=training_id,
    )
    db.add(notif)
    session.sent_to_player = True
    session.reformatting = True
    db.commit()
    background_tasks.add_task(reformat_training_for_player, training_id)
    return {"ok": True, "player_name": player.name}


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
            model="claude-opus-4-7",
            max_tokens=3000,
            messages=[{"role": "user", "content": prompt}],
        )
        session.player_program_text = response.content[0].text
        session.completed_drills = []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI update failed: {exc}")
    if session.player and session.player.player_user:
        notif = models.PlayerNotification(
            player_user_id=session.player.player_user.id,
            type="training_shared",
            title="Training Program Updated",
            body=f"{coach.name} updated your training program.",
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
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

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
        "Update the training program incorporating the coach feedback. Keep the same structure but adjust focus areas, drills, and weekly plan based on the feedback.\n"
        "IMPORTANT: Do NOT use ## headers or ** bold markers. Use plain text section labels."
    )

    import anthropic
    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}],
    )
    program_text = response.content[0].text

    import re
    priorities: list[str] = []
    m = re.search(r"KPI TARGETS(.*?)(?:CORRECTABLE|PROGRESS|$)", program_text, re.DOTALL | re.IGNORECASE)
    if m:
        for line in m.group(1).splitlines():
            line = re.sub(r"^[-·*\d\.\s↑↓]+", "", line).strip()
            if line:
                priorities.append(line)

    # Always insert a new row so the new training appears as a separate entry
    # in the Training Programs list rather than overwriting the existing one.
    session = models.TrainingSession(
        player_id=player_id,
        coach_id=coach.id,
        evaluation_id=latest.evaluation_id if latest else None,
        program_text=program_text,
        priorities=priorities[:6],
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session
