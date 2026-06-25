"""Staff-to-staff report sharing routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models, schemas

router = APIRouter(prefix="/staff-sharing", tags=["staff-sharing"])


def _resolve_report_text(report_type: str, report_id: int, db: Session) -> str | None:
    """Fetch the report_text from the appropriate table."""
    if report_type == "eval":
        ev = db.get(models.Evaluation, report_id)
        return ev.report_text if ev else None
    if report_type == "game":
        gr = db.get(models.GameReport, report_id)
        return gr.report_text if gr else None
    if report_type in ("team_training", "team_report"):
        tr = db.get(models.TeamReport, report_id)
        return tr.report_text if tr else None
    if report_type == "training":
        ts = db.get(models.TrainingSession, report_id)
        return ts.program_text if ts else None
    if report_type == "game_session":
        session = db.get(models.GameSession, report_id)
        if not session:
            return None
        lines = [f"GAME: vs {session.opponent_name}"]
        if session.date:
            lines.append(f"Date: {session.date.strftime('%B %d, %Y')}")
        if session.our_score is not None and session.opponent_score is not None:
            result_word = "W" if session.our_score > session.opponent_score else ("L" if session.our_score < session.opponent_score else "T")
            lines.append(f"Score: {result_word} {session.our_score}-{session.opponent_score}")
        if session.location:
            lines.append(f"Location: {session.location}")
        if session.ai_scouting_report:
            lines.append("")
            lines.append("AI SCOUTING REPORT:")
            lines.append(session.ai_scouting_report)
        return "\n".join(lines)
    return None


def _build_out(sr: models.StaffSharedReport, db: Session) -> schemas.StaffSharedReportOut:
    out = schemas.StaffSharedReportOut.model_validate(sr)
    out.sender_name = sr.sender.name if sr.sender else ""
    out.recipient_name = sr.recipient.name if sr.recipient else ""
    out.report_text = _resolve_report_text(sr.report_type, sr.report_id, db)
    out.regenerated_text = sr.regenerated_text
    return out


def _coach_notify(db: Session, coach_id: int, title: str, body: str, ref_id: int | None = None, ntype: str = "staff_share"):
    notif = models.CoachNotification(
        coach_id=coach_id,
        title=title,
        body=body,
        ref_id=ref_id,
        type=ntype,
    )
    db.add(notif)


@router.post("/share", response_model=schemas.StaffSharedReportOut)
def share_with_staff(
    body: schemas.StaffShareRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    recipient = db.get(models.Coach, body.recipient_id)
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient coach not found")
    if recipient.id == coach.id:
        raise HTTPException(status_code=400, detail="Cannot share with yourself")

    sr = models.StaffSharedReport(
        report_type=body.report_type,
        report_id=body.report_id,
        sender_id=coach.id,
        recipient_id=body.recipient_id,
        allow_regenerate=body.allow_regenerate,
    )
    db.add(sr)
    db.flush()

    # Notify recipient via CoachNotification
    _coach_notify(
        db, body.recipient_id,
        f"Report Shared by {coach.name}",
        f"{coach.name} shared a {body.report_type.replace('_', ' ')} report with you.",
        ref_id=sr.id,
        ntype="staff_report_shared",
    )
    db.commit()
    db.refresh(sr)
    return _build_out(sr, db)


@router.get("/inbox", response_model=list[schemas.StaffSharedReportOut])
def staff_inbox(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    reports = (
        db.query(models.StaffSharedReport)
        .filter_by(recipient_id=coach.id)
        .order_by(models.StaffSharedReport.id.desc())
        .all()
    )
    return [_build_out(r, db) for r in reports]


@router.get("/sent", response_model=list[schemas.StaffSharedReportOut])
def staff_sent(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    reports = (
        db.query(models.StaffSharedReport)
        .filter_by(sender_id=coach.id)
        .order_by(models.StaffSharedReport.id.desc())
        .all()
    )
    return [_build_out(r, db) for r in reports]


@router.get("/{shared_id}/comments", response_model=list[schemas.StaffReportCommentOut])
def get_comments(
    shared_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    sr = db.get(models.StaffSharedReport, shared_id)
    if not sr or (sr.sender_id != coach.id and sr.recipient_id != coach.id):
        raise HTTPException(status_code=404, detail="Shared report not found")
    comments = db.query(models.StaffReportComment).filter_by(shared_report_id=shared_id).all()
    result = []
    for c in comments:
        out = schemas.StaffReportCommentOut.model_validate(c)
        out.author_name = c.author.name if c.author else ""
        result.append(out)
    return result


@router.post("/{shared_id}/comments", response_model=schemas.StaffReportCommentOut)
def add_comment(
    shared_id: int,
    body: schemas.StaffReportCommentCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    sr = db.get(models.StaffSharedReport, shared_id)
    if not sr or (sr.sender_id != coach.id and sr.recipient_id != coach.id):
        raise HTTPException(status_code=404, detail="Shared report not found")
    comment = models.StaffReportComment(
        shared_report_id=shared_id,
        author_id=coach.id,
        text=body.text,
    )
    db.add(comment)
    db.flush()

    # Notify the other party
    other_id = sr.sender_id if coach.id == sr.recipient_id else sr.recipient_id
    _coach_notify(
        db, other_id,
        f"New comment from {coach.name}",
        body.text[:120],
        ref_id=shared_id,
        ntype="staff_report_comment",
    )
    db.commit()
    db.refresh(comment)
    out = schemas.StaffReportCommentOut.model_validate(comment)
    out.author_name = coach.name
    return out


@router.post("/{shared_id}/regenerate", response_model=schemas.StaffSharedReportOut)
async def regenerate_shared(
    shared_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    sr = db.get(models.StaffSharedReport, shared_id)
    if not sr or sr.recipient_id != coach.id:
        raise HTTPException(status_code=404, detail="Shared report not found")
    if not sr.allow_regenerate:
        raise HTTPException(status_code=403, detail="Regeneration not permitted for this share")
    feedback = (body.get("feedback") or "").strip()
    if not feedback:
        raise HTTPException(status_code=400, detail="Feedback required")

    report_text = _resolve_report_text(sr.report_type, sr.report_id, db)
    if not report_text:
        raise HTTPException(status_code=400, detail="No report content to regenerate")

    prompt = (
        f"You are a basketball analysis expert. Below is a report followed by feedback from a staff member. "
        f"Update the report to incorporate this feedback. Return ONLY the updated report text.\n\n"
        f"Do NOT use ## headers, ** bold markers, or ——— / === / --- dividers. "
        f"Use plain section titles in ALL CAPS followed by a colon and newline.\n\n"
        f"ORIGINAL REPORT:\n{report_text}\n\n"
        f"FEEDBACK:\n{feedback}\n\nUPDATED REPORT:"
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
            raise HTTPException(status_code=500, detail="AI returned no content")
        new_text = text_blocks[0].text.strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    # Store as regenerated_text — do NOT overwrite the original
    sr.regenerated_text = new_text

    # Notify original sender
    _coach_notify(
        db, sr.sender_id,
        f"Report Regenerated by {coach.name}",
        f"{coach.name} regenerated your shared {sr.report_type.replace('_', ' ')} report.",
        ref_id=sr.id,
        ntype="staff_report_regenerated",
    )
    db.commit()
    db.refresh(sr)
    return _build_out(sr, db)


@router.post("/{shared_id}/forward", response_model=schemas.StaffSharedReportOut)
def forward_shared(
    shared_id: int,
    body: schemas.StaffShareRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Forward a shared report (original or regenerated) to another staff member."""
    sr = db.get(models.StaffSharedReport, shared_id)
    if not sr or (sr.sender_id != coach.id and sr.recipient_id != coach.id):
        raise HTTPException(status_code=404, detail="Shared report not found")
    recipient = db.get(models.Coach, body.recipient_id)
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient coach not found")
    if recipient.id == coach.id:
        raise HTTPException(status_code=400, detail="Cannot forward to yourself")

    new_sr = models.StaffSharedReport(
        report_type=sr.report_type,
        report_id=sr.report_id,
        sender_id=coach.id,
        recipient_id=body.recipient_id,
        allow_regenerate=body.allow_regenerate,
    )
    db.add(new_sr)
    db.flush()

    _coach_notify(
        db, body.recipient_id,
        f"Report Forwarded by {coach.name}",
        f"{coach.name} forwarded a {sr.report_type.replace('_', ' ')} report to you.",
        ref_id=new_sr.id,
        ntype="staff_report_shared",
    )
    db.commit()
    db.refresh(new_sr)
    return _build_out(new_sr, db)


# ── Coach Notifications ────────────────────────────────────────────────────────

@router.get("/coach-notifications", response_model=list[schemas.CoachNotificationOut])
def list_coach_notifications(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    return (
        db.query(models.CoachNotification)
        .filter_by(coach_id=coach.id)
        .order_by(models.CoachNotification.id.desc())
        .limit(60)
        .all()
    )


@router.post("/coach-notifications/{notif_id}/read", response_model=schemas.CoachNotificationOut)
def mark_coach_notification_read(
    notif_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    n = db.get(models.CoachNotification, notif_id)
    if not n or n.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.read = True
    db.commit()
    db.refresh(n)
    return n


@router.post("/coach-notifications/read-all")
def mark_all_coach_notifications_read(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    db.query(models.CoachNotification).filter_by(coach_id=coach.id, read=False).update({"read": True})
    db.commit()
    return {"ok": True}
