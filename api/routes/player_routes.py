"""Player-facing routes: invites, link requests, shared reports, training, comments, notifications."""
import json
from datetime import datetime

import os
import secrets
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_coach
from .. import models, notify, schemas
from ..softdelete import soft_delete
from ..ownership import get_owned
from ..report_sections import _without_sections
from .player_auth import get_current_player_user
from ..ai_models import OPUS, text_of

router = APIRouter(prefix="/player", tags=["player"])


# ── Invite codes (coach generates) ───────────────────────────────────────────

@router.post("/invite/{player_id}", response_model=schemas.InviteCodeOut)
def generate_invite(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = get_owned(db, models.Player, player_id, coach.id, "Player")
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
    _add_player_link(db, pu, invite.player_id, invite.coach_id)
    invite.used = True
    db.commit()
    return {"ok": True, "player_name": invite.player.name}


def _add_player_link(db: Session, pu: models.PlayerUser, player_id: int, coach_id: int | None):
    """Link an account to a player profile (supports multiple). Keeps the first
    link as the primary (PlayerUser.player_id) used for profile editing."""
    if not pu.player_id:
        pu.player_id = player_id
    exists = db.query(models.PlayerUserLink).filter_by(
        player_user_id=pu.id, player_id=player_id
    ).first()
    if not exists:
        db.add(models.PlayerUserLink(player_user_id=pu.id, player_id=player_id, coach_id=coach_id))


@router.get("/links", response_model=list[schemas.PlayerLinkOut])
def list_player_links(
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    # Backfill: if the account has a primary player_id but no link rows yet
    # (legacy single-link accounts), surface it so it shows up and is unlinkable.
    links = db.query(models.PlayerUserLink).filter_by(player_user_id=pu.id).all()
    linked_ids = {l.player_id for l in links}
    if pu.player_id and pu.player_id not in linked_ids:
        db.add(models.PlayerUserLink(player_user_id=pu.id, player_id=pu.player_id))
        db.commit()
        links = db.query(models.PlayerUserLink).filter_by(player_user_id=pu.id).all()

    out = []
    for l in links:
        p = l.player
        if not p:
            continue
        out.append(schemas.PlayerLinkOut(
            player_id=p.id,
            player_name=p.name,
            program_name=p.program_name,
            team_name=p.team.name if p.team else None,
            coach_name=l.coach.name if l.coach else None,
            is_primary=(p.id == pu.player_id),
        ))
    return out


@router.delete("/links/{player_id}")
def unlink_player_link(
    player_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    link = db.query(models.PlayerUserLink).filter_by(
        player_user_id=pu.id, player_id=player_id
    ).first()
    if link:
        db.delete(link)
    # If we removed the primary, reassign it to another remaining link (or clear).
    if pu.player_id == player_id:
        remaining = db.query(models.PlayerUserLink).filter(
            models.PlayerUserLink.player_user_id == pu.id,
            models.PlayerUserLink.player_id != player_id,
        ).first()
        pu.player_id = remaining.player_id if remaining else None
    db.commit()
    return {"ok": True}


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
    # The coaches this request concerns: whoever owns the roster row, plus the
    # staff of that player's team. It used to be every coach in the database,
    # so a request about one program's player reached every unrelated coach —
    # noise in-app, and an unacceptable mailing once email rides these events.
    coach_ids: list[int] = []
    if player.coach_id:
        coach_ids.append(player.coach_id)
    if player.team_id:
        team = db.get(models.Team, player.team_id)
        if team:
            coach_ids.append(team.coach_id)
        coach_ids += [
            ts.coach_id for ts in
            db.query(models.TeamStaff).filter_by(team_id=player.team_id).all()
        ]
    # Dedupe while keeping order, so the roster owner is notified first and
    # nobody is told twice for holding two roles on the same team.
    seen: set[int] = set()
    recipients = [c for c in coach_ids if not (c in seen or seen.add(c))]

    for coach_id in recipients:
        db.add(models.PlayerNotification(
            coach_id=coach_id,
            type="link_requested",
            title="Player Link Request",
            body=f"{pu.name} is requesting to link to {player.name}'s profile.",
            i18n_key="notifs.linkRequest", i18n_params={"player": pu.name, "profile": player.name},
            ref_id=lr.id,
        ))
    db.commit()
    for coach_id in recipients:
        notify.coach_event(db.get(models.Coach, coach_id), "player_link_request",
                           {"player": pu.name, "profile": player.name})
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
        # Legacy notifications carried ref_id = player_user id (no LinkRequest).
        pu = db.get(models.PlayerUser, request_id)
        if not pu:
            raise HTTPException(status_code=404, detail="Request not found")
        # coach_id is what puts a player on a roster: the list is filtered by
        # ownership or team. Without it this row was created and immediately
        # invisible to the coach who had just approved it.
        player = models.Player(name=pu.name, program_name=coach.program_name,
                               coach_id=coach.id)
        db.add(player)
        db.flush()
        _add_player_link(db, pu, player.id, coach.id)
        db.add(models.PlayerNotification(
            player_user_id=pu.id, type="link_approved", title="Profile Linked",
            body=f"Your account has been linked to {coach.program_name}.",
            i18n_key="notifs.linkApprovedProgram", i18n_params={"program": coach.program_name},
            ref_id=player.id,
        ))
        db.commit()
        return {"ok": True}
    lr.status = "approved"
    _add_player_link(db, lr.player_user, lr.player_id, coach.id)
    # Approving a link is how a player joins this coach's roster, but the roster
    # is filtered on Player.coach_id and nothing was setting it — so a coach
    # approved someone and then could not find them. Only claimed when the row
    # has no owner: a player already on another coach's roster keeps that owner,
    # and both coaches keep their own record of the same athlete.
    linked_player = db.get(models.Player, lr.player_id)
    if linked_player and not linked_player.coach_id:
        linked_player.coach_id = coach.id
    notif = models.PlayerNotification(
        player_user_id=lr.player_user_id,
        type="link_approved",
        title="Profile Linked",
        body=f"Your account has been linked to {lr.player.name}'s profile.",
        i18n_key="notifs.linkApprovedProfile", i18n_params={"player": lr.player.name},
        ref_id=lr.player_id,
    )
    db.add(notif)
    db.commit()
    notify.player_event(lr.player_user, "player_link_approved",
                        {"team": coach.program_name or "your team"})
    return {"ok": True}


@router.post("/link-request/{request_id}/reject")
def reject_link(
    request_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    lr = db.get(models.LinkRequest, request_id)
    if not lr:
        # Legacy notification (no LinkRequest) — nothing to reject; just succeed.
        return {"ok": True}
    lr.status = "rejected"
    # Clean up the auto-created placeholder roster profile if it was never used.
    if lr.coach_id and lr.player and not lr.player.evaluations:
        player = lr.player
        db.delete(lr)
        soft_delete(db, player)
    db.commit()
    return {"ok": True}


# ── Link request to coach (player initiates) ─────────────────────────────────

@router.post("/link-request/coach/{coach_id}")
def request_link_to_coach(
    coach_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    """Player requests to link to a specific coach account. Creates a pending
    LinkRequest (with a roster profile in the coach's program) so the coach can
    approve/reject it from their notifications."""
    coach = db.get(models.Coach, coach_id)
    if not coach:
        raise HTTPException(status_code=404, detail="Coach not found")
    # Avoid duplicate pending requests to the same coach.
    dup = db.query(models.LinkRequest).filter_by(
        player_user_id=pu.id, coach_id=coach_id, status="pending"
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="Link request already sent")
    # Create a roster profile for this player in the coach's program.
    player = models.Player(name=pu.name, program_name=coach.program_name)
    db.add(player)
    db.flush()
    lr = models.LinkRequest(player_user_id=pu.id, player_id=player.id, coach_id=coach_id)
    db.add(lr)
    db.flush()
    notif = models.PlayerNotification(
        coach_id=coach_id,
        type="link_requested",
        title="Player Link Request",
        body=f"{pu.name} is requesting to link to your account.",
        i18n_key="notifs.linkRequestSelf", i18n_params={"player": pu.name},
        ref_id=lr.id,
    )
    db.add(notif)
    db.commit()
    # The other link-request route emails the coach; this one wrote the in-app
    # notification and stopped, so a request raised by searching for a coach by
    # name reached them only if they happened to open the app.
    notify.coach_event(coach, "player_link_request", {"player": pu.name})
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

@router.post("/share/{eval_id}")
def share_report(
    eval_id: int,
    body: schemas.ShareReportRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    ev = get_owned(db, models.Evaluation, eval_id, coach.id, "Evaluation")
    pu = db.get(models.PlayerUser, body.player_user_id)
    if not pu:
        raise HTTPException(status_code=404, detail="Player user not found")

    # Consent flow: this eval is about ev.player_id. Sending it to a DIFFERENT
    # player requires that subject player's approval first.
    if pu.player_id != ev.player_id:
        subject_player = db.get(models.Player, ev.player_id)
        subject_pu = subject_player.player_user if subject_player else None
        subject_name = subject_player.name if subject_player else "the player"
        recipient_name = pu.name or "the recipient"
        if subject_pu and not body.consent_override:
            approval = models.ShareApproval(
                coach_id=coach.id,
                subject_player_id=ev.player_id,
                subject_player_user_id=subject_pu.id,
                recipient_player_user_id=pu.id,
                kind="eval",
                output_type=ev.output_type,
                report_text="",   # eval payload lives in evaluation_id; keep non-null for legacy tables
                message=body.message,
                evaluation_id=eval_id,
                share_report_text=body.share_report_text,
                share_grades=body.share_grades,
                share_flags=body.share_flags,
                share_questions=body.share_questions,
                hidden_sections=json.dumps(body.hide_sections) if body.hide_sections else None,
                status="pending",
            )
            db.add(approval)
            db.flush()
            db.add(models.PlayerNotification(
                player_user_id=subject_pu.id,
                type="share_approval",
                title="Approval needed",
                body=(f"{coach.name} wants to send your {ev.output_type.replace('_', ' ')} report "
                      f"to {recipient_name}. Approve or reject sharing your report with a player it isn't about."),
                i18n_key="notifs.shareApproval",
                i18n_params={"coach": coach.name, "type": ev.output_type, "recipient": recipient_name},
                ref_id=approval.id,
            ))
            db.commit()
            return {"ok": True, "status": "pending_approval",
                    "subject_name": subject_name, "recipient_name": recipient_name}
        if not subject_pu and not body.consent_override:
            return {"ok": False, "status": "needs_override",
                    "subject_name": subject_name, "recipient_name": recipient_name}
        # consent_override -> fall through to a direct share.

    shared = models.SharedReport(
        evaluation_id=eval_id,
        player_user_id=body.player_user_id,
        shared_by_id=coach.id,
        share_report_text=body.share_report_text,
        share_grades=body.share_grades,
        share_flags=body.share_flags,
        share_questions=body.share_questions,
        hidden_sections=json.dumps(body.hide_sections) if body.hide_sections else None,
        message=body.message,
    )
    db.add(shared)
    db.flush()
    notif = models.PlayerNotification(
        player_user_id=body.player_user_id,
        type="report_shared",
        title="New Report Shared",
        body=f"{coach.name} shared a {ev.output_type.replace('_', ' ')} report with you.",
        i18n_key="notifs.reportShared", i18n_params={"coach": coach.name, "type": ev.output_type},
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
            model=OPUS,
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
            i18n_key="notifs.playerGeneratedTraining", i18n_params={"player": pu.name},
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


def _coach_training_out(session: "models.TrainingSession") -> dict:
    return {
        "id": session.id,
        "program_text": session.program_text,
        "player_program_text": session.player_program_text,
        "reformatting": session.reformatting,
        "completed_drills": session.completed_drills or [],
        "priorities": session.priorities,
        "coach_name": session.coach.name if session.coach else None,
        "created_at": session.created_at,
    }


@router.get("/coach-training")
def list_coach_training(
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    """All training programs a coach generated and sent directly, for merging
    into the player's My Training list alongside self-generated ones."""
    if not pu.player_id:
        return []
    sessions = (
        db.query(models.TrainingSession)
        .filter_by(player_id=pu.player_id, sent_to_player=True)
        .order_by(models.TrainingSession.id.desc())
        .all()
    )
    return [_coach_training_out(s) for s in sessions]


@router.get("/coach-training/{training_id}")
def get_coach_training(
    training_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    """A training program a coach generated and sent directly (TrainingSession),
    as opposed to a player-generated one (PlayerTraining)."""
    session = db.get(models.TrainingSession, training_id)
    if not session or not pu.player_id or session.player_id != pu.player_id:
        raise HTTPException(status_code=404, detail="Training program not found")
    return _coach_training_out(session)


@router.patch("/coach-training/{training_id}/progress")
def update_coach_training_progress(
    training_id: int,
    body: schemas.PlayerTrainingProgress,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    session = db.get(models.TrainingSession, training_id)
    if not session or not pu.player_id or session.player_id != pu.player_id:
        raise HTTPException(status_code=404, detail="Training program not found")
    session.completed_drills = body.completed_drills
    db.commit()
    return {"ok": True}


def _comment_out(c: models.PlayerComment) -> schemas.PlayerCommentOut:
    """One comment as the app reads it.

    The author's name, whether it has been rewritten since, and whether it has
    been taken back — a deleted comment keeps its place so the replies under it
    still read, but not its words.
    """
    out = schemas.PlayerCommentOut.model_validate(c)
    out.author_name = c.player_user.name if c.player_user else (c.coach.name if c.coach else "Unknown")
    out.edited = c.edited_at is not None
    out.deleted = c.deleted_at is not None
    if out.deleted:
        out.text = ""
    return out


@router.get("/coach-training/{training_id}/comments", response_model=list[schemas.PlayerCommentOut])
def list_coach_training_comments(
    training_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    session = db.get(models.TrainingSession, training_id)
    if not session or not pu.player_id or session.player_id != pu.player_id:
        raise HTTPException(status_code=404, detail="Training program not found")
    comments = (
        db.query(models.PlayerComment)
        .filter_by(training_session_id=training_id)
        .order_by(models.PlayerComment.id)
        .all()
    )
    result = []
    for c in comments:
        result.append(_comment_out(c))
    return result


@router.post("/coach-training/{training_id}/comments", response_model=schemas.PlayerCommentOut)
def add_coach_training_comment_player(
    training_id: int,
    body: schemas.PlayerCommentCreate,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    session = db.get(models.TrainingSession, training_id)
    if not session or not pu.player_id or session.player_id != pu.player_id:
        raise HTTPException(status_code=404, detail="Training program not found")
    comment = models.PlayerComment(
        player_user_id=pu.id,
        training_session_id=training_id,
        text=body.text,
        parent_id=body.parent_id,
    )
    db.add(comment)
    db.flush()
    notif = models.CoachNotification(
        coach_id=session.coach_id,
        type="player_commented_coach_training",
        title="Player Responded",
        body=f"{pu.name} commented on their training: \"{body.text[:80]}\"",
        i18n_key="notifs.playerCommentedTraining", i18n_params={"player": pu.name, "text": body.text[:80]},
        ref_id=training_id,
    )
    db.add(notif)
    db.commit()
    db.refresh(comment)
    out = schemas.PlayerCommentOut.model_validate(comment)
    out.author_name = pu.name
    return out


@router.post("/coach-training/{training_id}/refresh")
def refresh_coach_training(
    training_id: int,
    body: schemas.CoachTrainingRefresh,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    """Player-triggered update to their checklist version, incorporating
    feedback. The coach's own program_text is left untouched."""
    session = db.get(models.TrainingSession, training_id)
    if not session or not pu.player_id or session.player_id != pu.player_id:
        raise HTTPException(status_code=404, detail="Training program not found")
    from .training import build_player_training_prompt
    prompt = build_player_training_prompt(pu.name, session.program_text or "", body.feedback)
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
    notif = models.CoachNotification(
        coach_id=session.coach_id,
        type="training_feedback",
        title="Training Feedback",
        body=f"{pu.name} requested an update to their training: \"{body.feedback[:80]}\"",
        i18n_key="notifs.trainingFeedbackRequest", i18n_params={"player": pu.name, "text": body.feedback[:80]},
        ref_id=training_id,
    )
    db.add(notif)
    db.commit()
    db.refresh(session)
    return _coach_training_out(session)


@router.patch("/training/{training_id}/progress", response_model=schemas.PlayerTrainingOut)
def update_training_progress(
    training_id: int,
    body: schemas.PlayerTrainingProgress,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    pt = db.get(models.PlayerTraining, training_id)
    if not pt or pt.player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Training not found")
    # De-duplicate while preserving order.
    seen: set[str] = set()
    pt.completed_drills = [d for d in body.completed_drills if not (d in seen or seen.add(d))]
    db.commit()
    db.refresh(pt)
    return pt


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
        i18n_key="notifs.trainingNotesAdded",
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
            model=OPUS,
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
                i18n_key="notifs.playerUpdatedTraining", i18n_params={"player": pu.name},
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


def _training_corr_out(c: "models.TrainingCorrection") -> dict:
    return {"id": c.id, "correction": c.correction, "applied": c.applied, "created_at": c.created_at}


@router.get("/training/{training_id}/corrections")
def list_player_training_corrections(
    training_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    pt = db.get(models.PlayerTraining, training_id)
    if not pt or pt.player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Training not found")
    rows = (
        db.query(models.TrainingCorrection)
        .filter_by(player_training_id=training_id)
        .order_by(models.TrainingCorrection.id)
        .all()
    )
    return [_training_corr_out(c) for c in rows]


@router.post("/training/{training_id}/corrections")
def add_player_training_correction(
    training_id: int,
    body: schemas.PlayerCommentCreate,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    """Save a training correction for later without regenerating."""
    pt = db.get(models.PlayerTraining, training_id)
    if not pt or pt.player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Training not found")
    c = models.TrainingCorrection(player_training_id=training_id, correction=body.text)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _training_corr_out(c)


@router.post("/training/{training_id}/apply-corrections", response_model=schemas.PlayerTrainingOut)
async def apply_player_training_corrections(
    training_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    """Regenerate the program from all un-applied corrections, then mark them applied."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    pt = db.get(models.PlayerTraining, training_id)
    if not pt or pt.player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Training not found")
    pending = (
        db.query(models.TrainingCorrection)
        .filter_by(player_training_id=training_id, applied=False)
        .order_by(models.TrainingCorrection.id)
        .all()
    )
    if not pending:
        raise HTTPException(status_code=400, detail="No un-applied corrections to apply")
    feedback = "\n".join(f"- {c.correction}" for c in pending)
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model.\n"
        f"Here is an existing training program for {pu.name}:\n\n{pt.program_text or 'No previous program'}\n\n"
        f"The player has provided the following corrections/feedback:\n{feedback}\n\n"
        "Update the training program to incorporate ALL of this feedback. Keep the same structure but adjust "
        "drills, intensity, focus areas, and weekly plan. Format with clear sections."
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
        pt.program_text = text_blocks[0].text
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")
    for c in pending:
        c.applied = True
    db.commit()
    db.refresh(pt)
    return pt


@router.get("/coach-training/{training_id}/corrections-list")
def list_coach_training_corrections(
    training_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    session = db.get(models.TrainingSession, training_id)
    if not session or not pu.player_id or session.player_id != pu.player_id:
        raise HTTPException(status_code=404, detail="Training program not found")
    rows = (
        db.query(models.TrainingCorrection)
        .filter_by(training_session_id=training_id, coach_side=False)
        .order_by(models.TrainingCorrection.id)
        .all()
    )
    return [_training_corr_out(c) for c in rows]


@router.post("/coach-training/{training_id}/corrections")
def add_coach_training_correction(
    training_id: int,
    body: schemas.PlayerCommentCreate,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    session = db.get(models.TrainingSession, training_id)
    if not session or not pu.player_id or session.player_id != pu.player_id:
        raise HTTPException(status_code=404, detail="Training program not found")
    c = models.TrainingCorrection(training_session_id=training_id, correction=body.text, coach_side=False)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _training_corr_out(c)


@router.post("/coach-training/{training_id}/apply-corrections")
def apply_coach_training_corrections(
    training_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    session = db.get(models.TrainingSession, training_id)
    if not session or not pu.player_id or session.player_id != pu.player_id:
        raise HTTPException(status_code=404, detail="Training program not found")
    pending = (
        db.query(models.TrainingCorrection)
        .filter_by(training_session_id=training_id, applied=False, coach_side=False)
        .order_by(models.TrainingCorrection.id)
        .all()
    )
    if not pending:
        raise HTTPException(status_code=400, detail="No un-applied corrections to apply")
    feedback = "\n".join(f"- {c.correction}" for c in pending)
    from .training import build_player_training_prompt
    prompt = build_player_training_prompt(pu.name, session.program_text or "", feedback)
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
    for c in pending:
        c.applied = True
    db.add(models.CoachNotification(
        coach_id=session.coach_id,
        type="training_feedback",
        title="Training Feedback",
        body=f"{pu.name} applied corrections to their training.",
        i18n_key="notifs.trainingFeedbackApplied", i18n_params={"player": pu.name},
        ref_id=training_id,
    ))
    db.commit()
    db.refresh(session)
    return _coach_training_out(session)


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
            model=OPUS,
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
            i18n_key="notifs.trainingUpdatedByCoach", i18n_params={"coach": coach.name},
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
        parent_id=body.parent_id,
    )
    db.add(comment)
    db.flush()
    notif = models.PlayerNotification(
        coach_id=shared.shared_by_id,
        type="player_commented",
        title="Player Responded",
        body=f"{pu.name} commented on a shared report: \"{body.text[:80]}\"",
        i18n_key="notifs.playerCommentedReport", i18n_params={"player": pu.name, "text": body.text[:80]},
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
        parent_id=body.parent_id,
    )
    db.add(comment)
    db.flush()
    shared = pt.shared_report
    notif = models.PlayerNotification(
        coach_id=shared.shared_by_id,
        type="player_commented_training",
        title="Player Responded",
        body=f"{pu.name} commented on their training: \"{body.text[:80]}\"",
        i18n_key="notifs.playerCommentedTraining", i18n_params={"player": pu.name, "text": body.text[:80]},
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
        parent_id=body.parent_id,
    )
    db.add(comment)
    db.flush()
    notif = models.PlayerNotification(
        player_user_id=pt.player_user_id,
        type="training_updated",
        title="Coach Added Notes",
        body=f"A coach commented on your training: \"{body.text[:80]}\"",
        i18n_key="notifs.coachCommentedTraining", i18n_params={"text": body.text[:80]},
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
        result.append(_comment_out(c))
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
        result.append(_comment_out(c))
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


def _request_outcome(db: Session, ntype: str, ref_id: int | None) -> str | None:
    """Where an actionable notification's request stands, or None.

    The coach's decision used to live only in the responding session, so a
    reload put the Approve and Deny buttons back on a request that was already
    settled — and clicking them again asked the server to redo something it had
    already done. Reading the referenced row is what makes the answer outlive
    the screen.
    """
    if not ref_id:
        return None
    if ntype == "link_requested":
        lr = db.get(models.LinkRequest, ref_id)
        return lr.status if lr else None
    if ntype == "staff_report_request":
        sr = db.get(models.StaffSharedReport, ref_id)
        return sr.request_status if sr else None
    return None


@router.get("/coach-notifications")
def coach_notifications(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Return notifications from both PlayerNotification (coach_id) and CoachNotification."""
    player_notifs = (
        db.query(models.PlayerNotification)
        .filter_by(coach_id=coach.id)
        .order_by(models.PlayerNotification.id.desc())
        .limit(50)
        .all()
    )
    coach_notifs = (
        db.query(models.CoachNotification)
        .filter_by(coach_id=coach.id)
        .order_by(models.CoachNotification.id.desc())
        .limit(50)
        .all()
    )
    result = []
    for n in player_notifs:
        result.append({
            "id": n.id,
            "type": n.type,
            "title": n.title,
            "body": n.body,
            "read": n.read,
            "ref_id": n.ref_id,
            "created_at": n.created_at,
            "i18n_key": n.i18n_key,
            "i18n_params": n.i18n_params,
            "source": "player_notif",
            "outcome": _request_outcome(db, n.type, n.ref_id),
        })
    for n in coach_notifs:
        result.append({
            "id": n.id + 100000,  # offset to avoid ID collision with player notifs
            "type": n.type,
            "title": n.title,
            "body": n.body,
            "read": n.read,
            "ref_id": n.ref_id,
            "created_at": n.created_at,
            "i18n_key": n.i18n_key,
            "i18n_params": n.i18n_params,
            "source": "coach_notif",
            "coach_notif_id": n.id,
            "outcome": _request_outcome(db, n.type, n.ref_id),
        })
    result.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return result[:60]


@router.post("/coach-notifications/{notif_id}/read")
def coach_mark_read(
    notif_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    if notif_id >= 100000:
        real_id = notif_id - 100000
        n = db.get(models.CoachNotification, real_id)
        if n and n.coach_id == coach.id:
            n.read = True
            db.commit()
    else:
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
        result.append(_comment_out(c))
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
        # Fallback: older/ambiguous "player_commented" notifications carried a
        # training id here, not a shared-report id. Route those to the matching
        # training comment thread so the reply still lands instead of 404-ing.
        pt = db.get(models.PlayerTraining, shared_id)
        if pt:
            comment = models.PlayerComment(coach_id=coach.id, player_training_id=shared_id, text=body.text, parent_id=body.parent_id)
            db.add(comment)
            db.flush()
            db.add(models.PlayerNotification(
                player_user_id=pt.player_user_id,
                type="training_updated",
                title="Coach Added Notes",
                body=f"A coach commented on your training: \"{body.text[:80]}\"",
                i18n_key="notifs.coachCommentedTraining", i18n_params={"text": body.text[:80]},
                ref_id=shared_id,
            ))
            db.commit()
            db.refresh(comment)
            out = schemas.PlayerCommentOut.model_validate(comment)
            out.author_name = coach.name
            return out
        ts = db.get(models.TrainingSession, shared_id)
        if ts and ts.coach_id == coach.id:
            comment = models.PlayerComment(coach_id=coach.id, training_session_id=shared_id, text=body.text, parent_id=body.parent_id)
            db.add(comment)
            db.flush()
            if ts.player and ts.player.player_user:
                db.add(models.PlayerNotification(
                    player_user_id=ts.player.player_user.id,
                    type="training_shared",
                    title="Coach Replied",
                    body=f"{coach.name} commented on your training: \"{body.text[:80]}\"",
                    i18n_key="notifs.coachRepliedTraining",
                    i18n_params={"coach": coach.name, "text": body.text[:80]},
                    ref_id=shared_id,
                ))
            db.commit()
            db.refresh(comment)
            out = schemas.PlayerCommentOut.model_validate(comment)
            out.author_name = coach.name
            return out
        raise HTTPException(status_code=404, detail="Report not found")
    comment = models.PlayerComment(
        coach_id=coach.id,
        shared_report_id=shared_id,
        text=body.text,
        parent_id=body.parent_id,
    )
    db.add(comment)
    db.flush()
    notif = models.PlayerNotification(
        player_user_id=shared.player_user_id,
        type="coach_replied",
        title="Coach Replied",
        body=f"{coach.name} replied to your report comment: \"{body.text[:80]}\"",
        i18n_key="notifs.coachRepliedComment", i18n_params={"coach": coach.name, "text": body.text[:80]},
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
    db.query(models.CoachNotification).filter_by(
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
        recipient = db.get(models.PlayerUser, body.player_user_id)
        # Consent flow: sending an individual player's report to a DIFFERENT
        # player requires the subject player's approval first.
        if body.require_consent and body.subject_player_id and recipient:
            recipient_player_id = recipient.player_id
            if recipient_player_id != body.subject_player_id:
                subject_player = db.get(models.Player, body.subject_player_id)
                subject_pu = subject_player.player_user if subject_player else None
                subject_name = subject_player.name if subject_player else "the player"
                recipient_name = recipient.name or "the recipient"
                if subject_pu and not body.consent_override:
                    approval = models.ShareApproval(
                        coach_id=coach.id,
                        subject_player_id=body.subject_player_id,
                        subject_player_user_id=subject_pu.id,
                        recipient_player_user_id=recipient.id,
                        output_type=body.output_type,
                        report_text=body.report_text,
                        message=body.message,
                        status="pending",
                    )
                    db.add(approval)
                    db.flush()
                    db.add(models.PlayerNotification(
                        player_user_id=subject_pu.id,
                        type="share_approval",
                        title="Approval needed",
                        body=(f"{coach.name} wants to send your "
                              f"{body.output_type.replace('_', ' ')} report to {recipient_name}. "
                              f"Approve or reject sharing your report with a player it isn't about."),
                        i18n_key="notifs.shareApproval",
                        i18n_params={"coach": coach.name, "type": body.output_type,
                                     "recipient": recipient_name},
                        ref_id=approval.id,
                    ))
                    db.commit()
                    return {"ok": True, "status": "pending_approval",
                            "subject_name": subject_name, "recipient_name": recipient_name}
                if not subject_pu and not body.consent_override:
                    # No account to approve — let the coach confirm an override.
                    return {"ok": False, "status": "needs_override",
                            "subject_name": subject_name, "recipient_name": recipient_name}
                # consent_override -> fall through to a direct share.
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
                i18n_key="notifs.teamReportSharedCoach",
                i18n_params={"coach": coach.name, "type": body.output_type, "preview": preview},
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
            i18n_key="notifs.teamReportSharedPlayer",
            i18n_params={"coach": coach.name, "type": body.output_type},
            ref_id=tsr.id,
        )
        db.add(notif)
        count += 1

    db.commit()
    return {"ok": True, "shared_count": count}


@router.get("/share-approvals")
def list_share_approvals(
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    """Pending consent requests where THIS player is the report subject."""
    rows = (
        db.query(models.ShareApproval)
        .filter_by(subject_player_user_id=pu.id, status="pending")
        .order_by(models.ShareApproval.id.desc())
        .all()
    )
    out = []
    for a in rows:
        coach = db.get(models.Coach, a.coach_id)
        recip = db.get(models.PlayerUser, a.recipient_player_user_id)
        subj = db.get(models.Player, a.subject_player_id)
        out.append({
            "id": a.id,
            "coach_name": coach.name if coach else "Coach",
            "subject_player_name": subj.name if subj else "",
            "recipient_name": (recip.name if recip else "the recipient"),
            "output_type": a.output_type,
            "status": a.status,
            "created_at": a.created_at,
        })
    return out


@router.post("/share-approvals/{approval_id}/approve")
def approve_share(
    approval_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    a = db.get(models.ShareApproval, approval_id)
    if not a or a.subject_player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Approval not found")
    if a.status != "pending":
        return {"ok": True, "status": a.status}
    coach = db.get(models.Coach, a.coach_id)
    if a.kind == "eval" and a.evaluation_id:
        shared = models.SharedReport(
            evaluation_id=a.evaluation_id,
            player_user_id=a.recipient_player_user_id,
            shared_by_id=a.coach_id,
            share_report_text=bool(a.share_report_text),
            share_grades=bool(a.share_grades),
            share_flags=bool(a.share_flags),
            share_questions=bool(a.share_questions),
            # Carry the coach's choice through approval — the withheld sections
            # were chosen when the share was requested, not when it was approved.
            hidden_sections=a.hidden_sections,
            message=a.message,
        )
        db.add(shared)
        db.flush()
        db.add(models.PlayerNotification(
            player_user_id=a.recipient_player_user_id,
            type="report_shared",
            title="New Report Shared",
            body=f"{coach.name if coach else 'A coach'} shared a {a.output_type.replace('_', ' ')} report with you.",
            i18n_key="notifs.reportShared",
            i18n_params={"coach": coach.name if coach else None, "type": a.output_type},
            ref_id=shared.id,
        ))
    else:
        tsr = models.TeamSharedReport(
            player_user_id=a.recipient_player_user_id,
            shared_by_id=a.coach_id,
            output_type=a.output_type,
            report_text=a.report_text or "",
            message=a.message,
        )
        db.add(tsr)
        db.flush()
        db.add(models.PlayerNotification(
            player_user_id=a.recipient_player_user_id,
            type="team_report_shared",
            title="Report Shared",
            body=f"{coach.name if coach else 'A coach'} shared a {a.output_type.replace('_', ' ')} report with you.",
            i18n_key="notifs.reportShared",
            i18n_params={"coach": coach.name if coach else None, "type": a.output_type},
            ref_id=tsr.id,
        ))
    db.add(models.PlayerNotification(
        coach_id=a.coach_id,
        type="share_approved",
        title="Share approved",
        body=f"{pu.name} approved sharing their {a.output_type.replace('_', ' ')} report.",
        i18n_key="notifs.shareApproved", i18n_params={"player": pu.name, "type": a.output_type},
    ))
    a.status = "approved"
    db.commit()
    return {"ok": True, "status": "approved"}


@router.post("/share-approvals/{approval_id}/reject")
def reject_share(
    approval_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    a = db.get(models.ShareApproval, approval_id)
    if not a or a.subject_player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Approval not found")
    if a.status == "pending":
        a.status = "rejected"
        db.add(models.PlayerNotification(
            coach_id=a.coach_id,
            type="share_rejected",
            title="Share declined",
            body=f"{pu.name} declined sharing their {a.output_type.replace('_', ' ')} report.",
            i18n_key="notifs.shareRejected", i18n_params={"player": pu.name, "type": a.output_type},
        ))
        db.commit()
    return {"ok": True, "status": a.status}


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
            # An eval is shared by reference, so the sections the coach switched
            # off are removed here, on the way out — not at share time.
            hidden = []
            if getattr(shared, "hidden_sections", None):
                try:
                    hidden = json.loads(shared.hidden_sections) or []
                except Exception:
                    hidden = []
            out.report_text = _without_sections(ev.report_text or "", hidden) if hidden else ev.report_text
        if shared.share_grades:
            out.overall_grade = ev.overall_grade
            out.pillar_grades = ev.pillar_grades
        if shared.share_flags:
            out.green_flags = ev.green_flags
            out.watch_flags = ev.watch_flags
        if shared.share_questions:
            out.key_questions = ev.key_questions
    return out


# ── Editing and taking back a comment ────────────────────────────────────────
#
# A thread is read by both sides. Each may change or remove their own line and
# nobody else's — a coach rewriting a player's comment, or the reverse, would
# leave the record useless to both of them.


class CommentEdit(BaseModel):
    text: str


def _edit(c: models.PlayerComment, text: str) -> schemas.PlayerCommentOut:
    if c.deleted_at is not None:
        raise HTTPException(status_code=400, detail="That comment was deleted.")
    clean = (text or "").strip()
    if not clean:
        raise HTTPException(status_code=400, detail="A comment cannot be empty.")
    c.text = clean
    c.edited_at = datetime.utcnow()
    return c


def _soft_delete(c: models.PlayerComment) -> None:
    """Recorded rather than performed — a comment with replies under it is a
    thread, and deleting the row takes them with it."""
    c.deleted_at = datetime.utcnow()


@router.patch("/comments/{comment_id}", response_model=schemas.PlayerCommentOut)
def player_edit_comment(
    comment_id: int,
    body: CommentEdit,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    c = db.get(models.PlayerComment, comment_id)
    if not c or c.player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Comment not found")
    _edit(c, body.text)
    db.commit(); db.refresh(c)
    return _comment_out(c)


@router.delete("/comments/{comment_id}", response_model=schemas.PlayerCommentOut)
def player_delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    c = db.get(models.PlayerComment, comment_id)
    if not c or c.player_user_id != pu.id:
        raise HTTPException(status_code=404, detail="Comment not found")
    _soft_delete(c)
    db.commit(); db.refresh(c)
    return _comment_out(c)


@router.patch("/coach-comments/{comment_id}", response_model=schemas.PlayerCommentOut)
def coach_edit_comment(
    comment_id: int,
    body: CommentEdit,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    c = db.get(models.PlayerComment, comment_id)
    if not c or c.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Comment not found")
    _edit(c, body.text)
    db.commit(); db.refresh(c)
    return _comment_out(c)


@router.delete("/coach-comments/{comment_id}", response_model=schemas.PlayerCommentOut)
def coach_delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    c = db.get(models.PlayerComment, comment_id)
    if not c or c.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Comment not found")
    _soft_delete(c)
    db.commit(); db.refresh(c)
    return _comment_out(c)
