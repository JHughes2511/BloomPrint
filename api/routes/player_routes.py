"""Player-facing routes: invites, link requests, shared reports, training, comments, notifications."""

import os
import secrets
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_coach
from .. import models, schemas
from .player_auth import get_current_player_user

router = APIRouter(prefix="/player", tags=["player"])


# ── Invite codes (coach generates) ───────────────────────────────────────────

@router.post("/invite/{player_id}", response_model=schemas.InviteCodeOut)
def generate_invite(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    code = secrets.token_urlsafe(8).upper()
    invite = models.InviteCode(code=code, coach_id=coach.id, player_id=player_id)
    db.add(invite)
    db.commit()
    return schemas.InviteCodeOut(code=code, player_name=player.name)


@router.post("/use-invite")
def use_invite(
    body: dict,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    code = (body.get("code") or "").strip().upper()
    invite = db.query(models.InviteCode).filter_by(code=code, used=False).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invalid or already used invite code")
    pu.player_id = invite.player_id
    invite.used = True
    db.commit()
    return {"ok": True, "player_name": invite.player.name}


# ── Link requests (player initiates) ─────────────────────────────────────────

@router.post("/link-request/{player_id}")
def request_link(
    player_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    existing = db.query(models.LinkRequest).filter_by(
        player_user_id=pu.id, player_id=player_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Link request already sent")
    lr = models.LinkRequest(player_user_id=pu.id, player_id=player_id)
    db.add(lr)
    db.flush()
    # Notify all coaches about the link request
    coaches = db.query(models.Coach).all()
    for coach in coaches:
        notif = models.PlayerNotification(
            coach_id=coach.id,
            type="link_requested",
            title="Player Link Request",
            body=f"{pu.name} is requesting to link to {player.name}'s profile.",
            ref_id=lr.id,
        )
        db.add(notif)
    db.commit()
    return {"ok": True}


@router.get("/link-requests", response_model=list[schemas.LinkRequestOut])
def list_link_requests(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    requests = db.query(models.LinkRequest).filter_by(status="pending").all()
    result = []
    for lr in requests:
        out = schemas.LinkRequestOut.model_validate(lr)
        out.player_user_name = lr.player_user.name if lr.player_user else ""
        out.player_name = lr.player.name if lr.player else ""
        result.append(out)
    return result


@router.post("/link-request/{request_id}/approve")
def approve_link(
    request_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    lr = db.get(models.LinkRequest, request_id)
    if not lr:
        raise HTTPException(status_code=404, detail="Request not found")
    lr.status = "approved"
    lr.player_user.player_id = lr.player_id
    notif = models.PlayerNotification(
        player_user_id=lr.player_user_id,
        type="link_approved",
        title="Profile Linked",
        body=f"Your account has been linked to {lr.player.name}'s profile.",
        ref_id=lr.player_id,
    )
    db.add(notif)
    db.commit()
    return {"ok": True}


@router.post("/link-request/{request_id}/reject")
def reject_link(
    request_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    lr = db.get(models.LinkRequest, request_id)
    if not lr:
        raise HTTPException(status_code=404, detail="Request not found")
    lr.status = "rejected"
    db.commit()
    return {"ok": True}


# ── Link request to coach (player initiates) ─────────────────────────────────

@router.post("/link-request/coach/{coach_id}")
def request_link_to_coach(
    coach_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    """Player requests to link to a specific coach account."""
    coach = db.get(models.Coach, coach_id)
    if not coach:
        raise HTTPException(status_code=404, detail="Coach not found")
    # Notify the coach
    notif = models.PlayerNotification(
        coach_id=coach_id,
        type="link_requested",
        title="Player Link Request",
        body=f"{pu.name} is requesting to link to your account.",
        ref_id=pu.id,
    )
    db.add(notif)
    db.commit()
    return {"ok": True}


# ── Search coaches/staff (player side) ────────────────────────────────────────

@router.get("/search-staff")
def player_search_staff(
    q: str = "",
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    """Search coach/trainer/scout accounts (player side)."""
    results = (
        db.query(models.Coach)
        .filter(
            (models.Coach.name.ilike(f"%{q}%")) |
            (models.Coach.program_name.ilike(f"%{q}%"))
        )
        .limit(15)
        .all()
    )
    return [
        {"id": c.id, "name": c.name, "role": c.role, "program_name": c.program_name}
        for c in results
    ]


# ── Search players for linking (player side) ──────────────────────────────────

@router.get("/search-players")
def search_players(
    q: str = "",
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    results = (
        db.query(models.Player)
        .filter(models.Player.name.ilike(f"%{q}%"))
        .limit(10)
        .all()
    )
    return [
        {
            "id": p.id,
            "name": p.name,
            "team_name": p.program_name,
            "position": p.position,
        }
        for p in results
    ]


# ── Search player users (coach side) ─────────────────────────────────────────

@router.get("/search-player-users")
def search_player_users(
    q: str = "",
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    results = (
        db.query(models.PlayerUser)
        .filter(models.PlayerUser.name.ilike(f"%{q}%"))
        .limit(10)
        .all()
    )
    return [
        {
            "id": pu.id,
            "name": pu.name,
            "email": pu.email,
            "linked_player": pu.player.name if pu.player else None,
        }
        for pu in results
    ]


# ── Share report (coach → player) ────────────────────────────────────────────

@router.post("/share/{eval_id}", response_model=schemas.SharedReportOut)
def share_report(
    eval_id: int,
    body: schemas.ShareReportRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    ev = db.get(models.Evaluation, eval_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    pu = db.get(models.PlayerUser, body.player_user_id)
    if not pu:
        raise HTTPException(status_code=404, detail="Player user not found")
    shared = models.SharedReport(
        evaluation_id=eval_id,
        player_user_id=body.player_user_id,
        shared_by_id=coach.id,
        share_report_text=body.share_report_text,
        share_grades=body.share_grades,
        share_flags=body.share_flags,
        share_questions=body.share_questions,
        message=body.message,
    )
    db.add(shared)
    db.flush()
    notif = models.PlayerNotification(
        player_user_id=body.player_user_id,
        type="report_shared",
        title="New Report Shared",
        body=f"{coach.name} shared a {ev.output_type.replace('_', ' ')} report with you.",
        ref_id=shared.id,
    )
    db.add(notif)
    db.commit()
    db.refresh(shared)
    return _build_shared_report_out(shared)


@router.get("/shared-reports", response_model=list[schemas.SharedReportOut])
def player_shared_reports(
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    reports = (
        db.query(models.SharedReport)
        .filter_by(player_user_id=pu.id)
        .order_by(models.SharedReport.id.desc())
        .all()
    )
    return [_build_shared_report_out(r) for r in reports]


@router.get("/shared-reports/sent", response_model=list[schemas.SharedReportOut])
def coach_sent_reports(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    reports = (
        db.query(models.SharedReport)
        .filter_by(shared_by_id=coach.id)
        .order_by(models.SharedReport.id.desc())
        .all()
    )
    return [_build_shared_report_out(r) for r in reports]


@router.get("/shared-reports/{shared_id}", response_model=schemas.SharedReportOut)
def get_shared_report(
    shared_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    report = db.get(models.SharedReport, shared_id)
    if not report or report.player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Report not found")
    return _build_shared_report_out(report)


# ── Player training ───────────────────────────────────────────────────────────

@router.post("/training/generate/{shared_report_id}", response_model=schemas.PlayerTrainingOut)
async def generate_player_training(
    shared_report_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    shared = db.get(models.SharedReport, shared_report_id)
    if not shared or shared.player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Shared report not found")
    ev = shared.evaluation
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model. "
        f"Generate a personalized training program for {pu.name} based on the following evaluation report.\n\n"
        f"EVALUATION TYPE: {ev.output_type.replace('_', ' ')}\n"
        f"REPORT:\n{ev.report_text or 'No report text available'}\n\n"
        "Create a detailed, actionable training program with specific drills, focus areas, and weekly structure. "
        "Prioritize areas for improvement while reinforcing strengths. Format with clear sections."
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
        program_text = text_blocks[0].text
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    pt = models.PlayerTraining(
        player_user_id=pu.id,
        shared_report_id=shared_report_id,
        program_text=program_text,
    )
    db.add(pt)
    db.flush()

    coaches = db.query(models.Coach).all()
    for coach in coaches:
        notif = models.PlayerNotification(
            coach_id=coach.id,
            type="training_generated",
            title="Player Generated Training",
            body=f"{pu.name} generated a training program from a shared report.",
            ref_id=pt.id,
        )
        db.add(notif)
    db.commit()
    db.refresh(pt)
    return pt


@router.get("/training", response_model=list[schemas.PlayerTrainingOut])
def list_player_training(
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    return (
        db.query(models.PlayerTraining)
        .filter_by(player_user_id=pu.id)
        .order_by(models.PlayerTraining.id.desc())
        .all()
    )


@router.get("/training/coach-view", response_model=list[schemas.PlayerTrainingOut])
def coach_view_training(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    shared_ids = [
        s.id
        for s in db.query(models.SharedReport).filter_by(shared_by_id=coach.id).all()
    ]
    return (
        db.query(models.PlayerTraining)
        .filter(models.PlayerTraining.shared_report_id.in_(shared_ids))
        .order_by(models.PlayerTraining.id.desc())
        .all()
    )


@router.patch("/training/{training_id}", response_model=schemas.PlayerTrainingOut)
def update_player_training(
    training_id: int,
    body: schemas.PlayerTrainingUpdate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    pt = db.get(models.PlayerTraining, training_id)
    if not pt:
        raise HTTPException(status_code=404, detail="Training not found")
    pt.coach_notes = body.coach_notes
    notif = models.PlayerNotification(
        player_user_id=pt.player_user_id,
        type="training_updated",
        title="Training Updated",
        body="A coach has added notes to your training program.",
        ref_id=pt.id,
    )
    db.add(notif)
    db.commit()
    db.refresh(pt)
    return pt


@router.get("/training/{training_id}/detail")
def get_training_detail(
    training_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    pt = db.get(models.PlayerTraining, training_id)
    if not pt:
        raise HTTPException(status_code=404, detail="Training not found")
    comments = db.query(models.PlayerComment).filter_by(player_training_id=training_id).all()
    comment_list = []
    for c in comments:
        out = schemas.PlayerCommentOut.model_validate(c)
        out.author_name = c.player_user.name if c.player_user else (c.coach.name if c.coach else "Unknown")
        comment_list.append(out.model_dump())
    player_name = pt.player_user.name if pt.player_user else "Unknown"
    return {
        "id": pt.id,
        "player_name": player_name,
        "program_text": pt.program_text,
        "coach_notes": pt.coach_notes,
        "created_at": pt.created_at,
        "updated_at": pt.updated_at,
        "comments": comment_list,
    }


@router.post("/training/{training_id}/refresh", response_model=schemas.PlayerTrainingOut)
async def refresh_player_training(
    training_id: int,
    body: dict,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    pt = db.get(models.PlayerTraining, training_id)
    if not pt or pt.player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Training not found")
    feedback = (body.get("feedback") or "").strip()
    if not feedback:
        raise HTTPException(status_code=400, detail="Feedback required")
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model.\n"
        f"Here is an existing training program for {pu.name}:\n\n"
        f"{pt.program_text or 'No previous program'}\n\n"
        f"The player has provided the following feedback:\n{feedback}\n\n"
        "Update the training program to incorporate this feedback. Keep the same structure but adjust drills, "
        "intensity, focus areas, and weekly plan based on the feedback. Format with clear sections."
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
        pt.program_text = text_blocks[0].text
        coaches = db.query(models.Coach).all()
        for coach in coaches:
            notif = models.PlayerNotification(
                coach_id=coach.id,
                type="training_refreshed",
                title="Player Updated Training",
                body=f"{pu.name} updated their training program with new feedback.",
                ref_id=pt.id,
            )
            db.add(notif)
        db.commit()
        db.refresh(pt)
        return pt
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")


@router.post("/training/{training_id}/coach-refresh", response_model=schemas.PlayerTrainingOut)
async def coach_refresh_training(
    training_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    pt = db.get(models.PlayerTraining, training_id)
    if not pt:
        raise HTTPException(status_code=404, detail="Training not found")
    feedback = (body.get("feedback") or "").strip()
    if not feedback:
        raise HTTPException(status_code=400, detail="Feedback required")
    player_name = pt.player_user.name if pt.player_user else "the player"
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model.\n"
        f"Here is an existing training program for {player_name}:\n\n"
        f"{pt.program_text or 'No previous program'}\n\n"
        f"Coach feedback:\n{feedback}\n\n"
        "Update the training program to incorporate the coach's feedback. Format with clear sections."
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
        pt.program_text = text_blocks[0].text
        notif = models.PlayerNotification(
            player_user_id=pt.player_user_id,
            type="training_updated",
            title="Training Updated by Coach",
            body=f"{coach.name} has updated your training program.",
            ref_id=pt.id,
        )
        db.add(notif)
        db.commit()
        db.refresh(pt)
        return pt
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")


# ── Comments ──────────────────────────────────────────────────────────────────

@router.post("/shared-reports/{shared_id}/comments", response_model=schemas.PlayerCommentOut)
def add_player_comment(
    shared_id: int,
    body: schemas.PlayerCommentCreate,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    shared = db.get(models.SharedReport, shared_id)
    if not shared or shared.player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Report not found")
    comment = models.PlayerComment(
        player_user_id=pu.id,
        shared_report_id=shared_id,
        text=body.text,
    )
    db.add(comment)
    db.flush()
    notif = models.PlayerNotification(
        coach_id=shared.shared_by_id,
        type="player_commented",
        title="Player Responded",
        body=f"{pu.name} commented on a shared report: \"{body.text[:80]}\"",
        ref_id=shared_id,
    )
    db.add(notif)
    db.commit()
    db.refresh(comment)
    out = schemas.PlayerCommentOut.model_validate(comment)
    out.author_name = pu.name
    return out


@router.post("/training/{training_id}/comments", response_model=schemas.PlayerCommentOut)
def add_training_comment_player(
    training_id: int,
    body: schemas.PlayerCommentCreate,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    pt = db.get(models.PlayerTraining, training_id)
    if not pt or pt.player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Training not found")
    comment = models.PlayerComment(
        player_user_id=pu.id,
        player_training_id=training_id,
        text=body.text,
    )
    db.add(comment)
    db.flush()
    shared = pt.shared_report
    notif = models.PlayerNotification(
        coach_id=shared.shared_by_id,
        type="player_commented",
        title="Player Responded",
        body=f"{pu.name} commented on their training: \"{body.text[:80]}\"",
        ref_id=training_id,
    )
    db.add(notif)
    db.commit()
    db.refresh(comment)
    out = schemas.PlayerCommentOut.model_validate(comment)
    out.author_name = pu.name
    return out


@router.post("/training/{training_id}/coach-comment", response_model=schemas.PlayerCommentOut)
def add_training_comment_coach(
    training_id: int,
    body: schemas.PlayerCommentCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    pt = db.get(models.PlayerTraining, training_id)
    if not pt:
        raise HTTPException(status_code=404, detail="Training not found")
    comment = models.PlayerComment(
        coach_id=coach.id,
        player_training_id=training_id,
        text=body.text,
    )
    db.add(comment)
    db.flush()
    notif = models.PlayerNotification(
        player_user_id=pt.player_user_id,
        type="training_updated",
        title="Coach Added Notes",
        body=f"A coach commented on your training: \"{body.text[:80]}\"",
        ref_id=training_id,
    )
    db.add(notif)
    db.commit()
    db.refresh(comment)
    out = schemas.PlayerCommentOut.model_validate(comment)
    out.author_name = coach.name
    return out


@router.get("/shared-reports/{shared_id}/comments", response_model=list[schemas.PlayerCommentOut])
def get_report_comments(
    shared_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    comments = db.query(models.PlayerComment).filter_by(shared_report_id=shared_id).all()
    result = []
    for c in comments:
        out = schemas.PlayerCommentOut.model_validate(c)
        out.author_name = (
            c.player_user.name if c.player_user else (c.coach.name if c.coach else "Unknown")
        )
        result.append(out)
    return result


@router.get("/training/{training_id}/comments", response_model=list[schemas.PlayerCommentOut])
def get_training_comments(
    training_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    comments = db.query(models.PlayerComment).filter_by(player_training_id=training_id).all()
    result = []
    for c in comments:
        out = schemas.PlayerCommentOut.model_validate(c)
        out.author_name = (
            c.player_user.name if c.player_user else (c.coach.name if c.coach else "Unknown")
        )
        result.append(out)
    return result


# ── Notifications ─────────────────────────────────────────────────────────────

@router.get("/notifications", response_model=list[schemas.NotificationOut])
def player_notifications(
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    return (
        db.query(models.PlayerNotification)
        .filter_by(player_user_id=pu.id)
        .order_by(models.PlayerNotification.id.desc())
        .limit(50)
        .all()
    )


@router.post("/notifications/read-all")
def player_mark_all_read(
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    db.query(models.PlayerNotification).filter_by(
        player_user_id=pu.id, read=False
    ).update({"read": True})
    db.commit()
    return {"ok": True}


@router.post("/notifications/{notif_id}/read")
def mark_read(
    notif_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    n = db.get(models.PlayerNotification, notif_id)
    if n and n.player_user_id == pu.id:
        n.read = True
        db.commit()
    return {"ok": True}


@router.get("/coach-notifications", response_model=list[schemas.NotificationOut])
def coach_notifications(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    return (
        db.query(models.PlayerNotification)
        .filter_by(coach_id=coach.id)
        .order_by(models.PlayerNotification.id.desc())
        .limit(50)
        .all()
    )


@router.post("/coach-notifications/{notif_id}/read")
def coach_mark_read(
    notif_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    n = db.get(models.PlayerNotification, notif_id)
    if n and n.coach_id == coach.id:
        n.read = True
        db.commit()
    return {"ok": True}


# ── Coach view + reply on shared reports ──────────────────────────────────────

@router.get("/shared-reports/{shared_id}/coach-view")
def coach_view_shared_report(
    shared_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    report = db.get(models.SharedReport, shared_id)
    if not report or report.shared_by_id != coach.id:
        raise HTTPException(status_code=404, detail="Report not found")
    comments = db.query(models.PlayerComment).filter_by(shared_report_id=shared_id).all()
    result = []
    for c in comments:
        out = schemas.PlayerCommentOut.model_validate(c)
        out.author_name = (
            c.player_user.name if c.player_user else (c.coach.name if c.coach else "Unknown")
        )
        result.append(out)
    return {"shared_report_id": shared_id, "comments": [c.model_dump() for c in result]}


@router.post("/shared-reports/{shared_id}/coach-reply", response_model=schemas.PlayerCommentOut)
def coach_reply_to_shared_report(
    shared_id: int,
    body: schemas.PlayerCommentCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    shared = db.get(models.SharedReport, shared_id)
    if not shared or shared.shared_by_id != coach.id:
        raise HTTPException(status_code=404, detail="Report not found")
    comment = models.PlayerComment(
        coach_id=coach.id,
        shared_report_id=shared_id,
        text=body.text,
    )
    db.add(comment)
    db.flush()
    notif = models.PlayerNotification(
        player_user_id=shared.player_user_id,
        type="coach_replied",
        title="Coach Replied",
        body=f"{coach.name} replied to your report comment: \"{body.text[:80]}\"",
        ref_id=shared_id,
    )
    db.add(notif)
    db.commit()
    db.refresh(comment)
    out = schemas.PlayerCommentOut.model_validate(comment)
    out.author_name = coach.name
    return out


# ── Mark all coach notifications read ─────────────────────────────────────────

@router.post("/coach-notifications/read-all")
def coach_mark_all_read(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    db.query(models.PlayerNotification).filter_by(
        coach_id=coach.id, read=False
    ).update({"read": True})
    db.commit()
    return {"ok": True}


# ── Share team report ─────────────────────────────────────────────────────────

@router.post("/share-team-report")
def share_team_report(
    body: schemas.TeamShareRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    targets: list[int] = []  # player_user_ids

    if body.target_type == "player" and body.player_user_id:
        targets = [body.player_user_id]

    elif body.target_type == "team" and body.team_id:
        # Find all players on this team who have a linked PlayerUser account
        players = db.query(models.Player).filter_by(team_id=body.team_id).all()
        for p in players:
            if p.player_user:
                targets.append(p.player_user.id)

    elif body.target_type == "all_staff":
        if body.staff_coach_id:
            # Send to specific staff member
            target_coaches = [db.get(models.Coach, body.staff_coach_id)]
            target_coaches = [c for c in target_coaches if c and c.id != coach.id]
        else:
            target_coaches = db.query(models.Coach).filter(models.Coach.id != coach.id).all()

        preview = body.report_text[:300] if body.report_text else ""
        for c in target_coaches:
            notif = models.PlayerNotification(
                coach_id=c.id,
                type="team_report_shared",
                title=f"Team Report: {body.output_type.replace('_', ' ').title()}",
                body=f"{coach.name} shared a team report with you.\n\n{preview}...",
            )
            db.add(notif)
        db.commit()
        return {"ok": True, "shared_count": len(target_coaches)}

    # Create TeamSharedReport for each target player user
    count = 0
    for pu_id in targets:
        pu = db.get(models.PlayerUser, pu_id)
        if not pu:
            continue
        tsr = models.TeamSharedReport(
            player_user_id=pu_id,
            shared_by_id=coach.id,
            output_type=body.output_type,
            report_text=body.report_text,
            message=body.message,
        )
        db.add(tsr)
        db.flush()
        notif = models.PlayerNotification(
            player_user_id=pu_id,
            type="team_report_shared",
            title=f"Team Report Shared",
            body=f"{coach.name} shared a {body.output_type.replace('_', ' ')} team report with you.",
            ref_id=tsr.id,
        )
        db.add(notif)
        count += 1

    db.commit()
    return {"ok": True, "shared_count": count}


@router.get("/team-shared-reports", response_model=list[schemas.TeamSharedReportOut])
def player_team_shared_reports(
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    reports = (
        db.query(models.TeamSharedReport)
        .filter_by(player_user_id=pu.id)
        .order_by(models.TeamSharedReport.id.desc())
        .all()
    )
    result = []
    for r in reports:
        out = schemas.TeamSharedReportOut.model_validate(r)
        out.shared_by_name = r.shared_by.name if r.shared_by else ""
        result.append(out)
    return result


# ── Staff search (coach-side) ────────────────────────────────────────────────

@router.get("/staff/search")
def search_staff(
    q: str = "",
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    results = (
        db.query(models.Coach)
        .filter(
            (models.Coach.name.ilike(f"%{q}%")) |
            (models.Coach.program_name.ilike(f"%{q}%"))
        )
        .filter(models.Coach.id != coach.id)
        .limit(10)
        .all()
    )
    return [
        {"id": c.id, "name": c.name, "role": c.role, "program_name": c.program_name}
        for c in results
    ]


# ── Helper ────────────────────────────────────────────────────────────────────

def _build_shared_report_out(shared: models.SharedReport) -> schemas.SharedReportOut:
    ev = shared.evaluation
    out = schemas.SharedReportOut.model_validate(shared)
    out.output_type = ev.output_type if ev else ""
    out.shared_by_name = shared.shared_by.name if shared.shared_by else ""
    if ev:
        if shared.share_report_text:
            out.report_text = ev.report_text
        if shared.share_grades:
            out.overall_grade = ev.overall_grade
            out.pillar_grades = ev.pillar_grades
        if shared.share_flags:
            out.green_flags = ev.green_flags
            out.watch_flags = ev.watch_flags
        if shared.share_questions:
            out.key_questions = ev.key_questions
    return out
