"""Staff-to-staff report sharing routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..player_grants import grant_players_for_share
from ..auth import get_current_coach
from .. import models, notify, schemas
from ..ai_models import OPUS

router = APIRouter(prefix="/staff-sharing", tags=["staff-sharing"])


def _resolve_report_text(report_type: str, report_id: int, db: Session, sender_id: int | None = None) -> str | None:
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
        # Prefer the SENDER's own scouting report for this game (per-coach); fall
        # back to the game's legacy report.
        scout_text = None
        if sender_id is not None:
            row = (
                db.query(models.GameScoutingReport)
                .filter_by(game_id=session.id, coach_id=sender_id)
                .first()
            )
            if row and row.report_text:
                scout_text = row.report_text
        if scout_text is None:
            scout_text = session.ai_scouting_report
        lines = [f"GAME: vs {session.opponent_name}"]
        if session.date:
            lines.append(f"Date: {session.date.strftime('%B %d, %Y')}")
        if session.our_score is not None and session.opponent_score is not None:
            result_word = "W" if session.our_score > session.opponent_score else ("L" if session.our_score < session.opponent_score else "T")
            lines.append(f"Score: {result_word} {session.our_score}-{session.opponent_score}")
        if session.location:
            lines.append(f"Location: {session.location}")
        if scout_text:
            lines.append("")
            lines.append("AI SCOUTING REPORT:")
            lines.append(scout_text)
        return "\n".join(lines)
    if report_type == "film":
        # A film breakdown is keyed by the CLIP, not the packet: one packet can
        # hold several films and each has its own analysis.
        clip = db.get(models.GameReportClip, report_id)
        return clip.analysis_text if clip else None
    if report_type == "game_report":
        session = db.get(models.GameSession, report_id)
        if not session:
            return None
        text = None
        if sender_id is not None:
            row = (
                db.query(models.GameFullReport)
                .filter_by(game_id=session.id, coach_id=sender_id)
                .first()
            )
            if row and row.report_text:
                text = row.report_text
        return text
    return None


def _report_meta(report_type: str, report_id: int, db: Session) -> tuple[str | None, str | None, float | None]:
    """(subject_name, output_type, overall_grade) for a shared report so the
    recipient's Recent list can render it like a normal report."""
    if report_type == "eval":
        ev = db.get(models.Evaluation, report_id)
        if not ev:
            return None, None, None
        player = db.get(models.Player, ev.player_id)
        return (player.name if player else "Player"), ev.output_type, ev.overall_grade
    if report_type == "game":
        gr = db.get(models.GameReport, report_id)
        if not gr:
            return None, None, None
        subject = gr.title or (f"vs {gr.opponent_name}" if gr.opponent_name else "Game Report")
        return subject, gr.output_type, None
    if report_type in ("team_training", "team_report"):
        tr = db.get(models.TeamReport, report_id)
        return ("Team Report" if tr else None), (tr.output_type if tr else None), None
    if report_type == "training":
        ts = db.get(models.TrainingSession, report_id)
        subject = (ts.player.name if ts and ts.player else "Training") if ts else None
        return subject, "training_program", None
    if report_type == "game_session":
        gs = db.get(models.GameSession, report_id)
        return ((f"vs {gs.opponent_name}" if gs else None), "scouting_report", None)
    if report_type == "film":
        clip = db.get(models.GameReportClip, report_id)
        if not clip:
            return None, None, None
        gr = db.get(models.GameReport, clip.game_report_id)
        subject = clip.team_name or (gr.title if gr else None) or "Film"
        return subject, "film_breakdown", None
    if report_type == "game_report":
        gs = db.get(models.GameSession, report_id)
        return ((f"vs {gs.opponent_name}" if gs else None), "game_report", None)
    return None, None, None


def _conversation_rows(sr: models.StaffSharedReport, db: Session):
    """Every share of the SAME report by the same sender.

    A report shared with three coaches is three rows, one per recipient — but
    it is one conversation. Sharing a scouting report with the staff and having
    each of them reply into a private thread nobody else can see is three
    conversations that each look like silence to everyone but its two
    participants.
    """
    return (db.query(models.StaffSharedReport)
              .filter_by(sender_id=sr.sender_id, report_type=sr.report_type,
                         report_id=sr.report_id)
              .all())


def _in_conversation(sr: models.StaffSharedReport, coach_id: int, db: Session) -> bool:
    """Is this coach the sender or one of the recipients of this report?"""
    if sr.sender_id == coach_id:
        return True
    return any(r.recipient_id == coach_id for r in _conversation_rows(sr, db))


def _build_out(sr: models.StaffSharedReport, db: Session) -> schemas.StaffSharedReportOut:
    out = schemas.StaffSharedReportOut.model_validate(sr)
    out.sender_name = sr.sender.name if sr.sender else ""
    out.recipient_name = sr.recipient.name if sr.recipient else ""
    # A frozen snapshot (section-filtered, non-regenerable) takes precedence over
    # the live report text so the recipient sees exactly the controlled copy.
    out.report_text = sr.frozen_text if sr.frozen_text else _resolve_report_text(sr.report_type, sr.report_id, db, sr.sender_id)
    out.regenerated_text = sr.regenerated_text
    out.subject_name, out.output_type, out.overall_grade = _report_meta(sr.report_type, sr.report_id, db)
    # Counted across the whole conversation, so the number on the card matches
    # the number of replies the coach will actually find when they open it.
    rows = _conversation_rows(sr, db)
    ids = [r.id for r in rows]
    comments = (db.query(models.StaffReportComment)
                  .filter(models.StaffReportComment.shared_report_id.in_(ids)).all())
    out.note_count = sum(1 for c in comments if (c.text or "").startswith("[Coach Note]"))
    out.comment_count = len(comments) - out.note_count
    out.recipient_names = [r.recipient.name for r in rows if r.recipient]
    return out


# Which in-app notification types are also worth an email. Types absent here
# stay in-app only.
_EMAIL_EVENTS = {
    "staff_report_shared": "report_shared",
    "staff_report_request": "report_request",
    "staff_report_declined": "report_declined",
}


def _coach_notify(db: Session, coach_id: int, title: str, body: str, ref_id: int | None = None,
                  ntype: str = "staff_share", key: str | None = None, params: dict | None = None):
    """Queue a notification for a coach.

    `key`/`params` are what the recipient's client actually renders, in the
    recipient's language. `title`/`body` are the English fallback kept for rows
    written before this sender was migrated — never drop them.
    """
    notif = models.CoachNotification(
        coach_id=coach_id,
        title=title,
        body=body,
        i18n_key=key,
        i18n_params=params,
        ref_id=ref_id,
        type=ntype,
    )
    db.add(notif)

    # Email is a channel on this same event, decided in one place rather than at
    # each of the ten call sites. Comments and regenerations are deliberately
    # absent: they are frequent, in-app is enough, and mailing them is how
    # people learn to filter the domain.
    event = _EMAIL_EVENTS.get(ntype)
    if event:
        p = params or {}
        notify.coach_event(db.get(models.Coach, coach_id), event, {
            "sender": p.get("coach") or "A coach",
            "report": (p.get("type") or "report").replace("_", " "),
        })


def _upsert_share(db: Session, report_type: str, report_id: int, sender_id: int,
                  recipient_id: int, allow_regenerate: bool, frozen: str | None):
    """Create a share, or update the existing one for the same
    (report, sender, recipient) — never a duplicate row. Returns (share, is_new)."""
    existing = (
        db.query(models.StaffSharedReport)
        .filter_by(report_type=report_type, report_id=report_id,
                   sender_id=sender_id, recipient_id=recipient_id)
        .first()
    )
    if existing:
        existing.allow_regenerate = allow_regenerate
        existing.frozen_text = frozen
        db.flush()
        return existing, False
    sr = models.StaffSharedReport(
        report_type=report_type, report_id=report_id, sender_id=sender_id,
        recipient_id=recipient_id, allow_regenerate=allow_regenerate, frozen_text=frozen,
    )
    db.add(sr)
    db.flush()
    return sr, True


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

    # A frozen snapshot is only meaningful when regeneration is NOT allowed.
    frozen = body.frozen_text if (body.frozen_text and not body.allow_regenerate) else None

    sr, _ = _upsert_share(db, body.report_type, body.report_id, coach.id,
                          body.recipient_id, body.allow_regenerate, frozen)

    # The report is about people. Hand them over with it, or the recipient
    # reads an evaluation of a player they cannot look up anywhere.
    grant_players_for_share(db, body.report_type, body.report_id, coach, body.recipient_id)

    # Notify recipient via CoachNotification
    _coach_notify(
        db, body.recipient_id,
        f"Report Shared by {coach.name}",
        f"{coach.name} shared a {body.report_type.replace('_', ' ')} report with you.",
        ref_id=sr.id,
        ntype="staff_report_shared",
        key="notifs.staffReportShared", params={"coach": coach.name, "type": body.report_type},
    )
    db.commit()
    db.refresh(sr)
    return _build_out(sr, db)


def _resolve_group_recipients(
    kind: str,
    coach_id: int | None,
    team_id: int | None,
    program_name: str | None,
    sender_id: int,
    db: Session,
) -> list[int]:
    """Resolve a share target (coach/team/program) into a deduped list of
    recipient coach ids, excluding the sender."""
    ids: set[int] = set()
    if kind == "coach" and coach_id:
        ids.add(coach_id)
    elif kind == "team" and team_id:
        team = db.get(models.Team, team_id)
        if team:
            ids.add(team.coach_id)  # team owner
            for link in db.query(models.TeamStaff).filter_by(team_id=team_id).all():
                ids.add(link.coach_id)
    elif kind == "program" and program_name:
        for c in db.query(models.Coach).filter(models.Coach.program_name.ilike(program_name)).all():
            ids.add(c.id)
    ids.discard(sender_id)
    return list(ids)


@router.get("/search-targets", response_model=list[schemas.StaffShareTargetOut])
def search_share_targets(
    q: str = "",
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Search staff share targets by coach name, team name, or program name.

    Returns a mixed list of individual coaches plus team/program groups so the
    sender can reach an entire connected staff in one action.
    """
    q = (q or "").strip()
    results: list[schemas.StaffShareTargetOut] = []
    if not q:
        return results

    like = f"%{q}%"

    # ── Team groups (everyone connected to a matching team) ──────────────────
    teams = db.query(models.Team).filter(models.Team.name.ilike(like)).limit(10).all()
    for t in teams:
        recipients = _resolve_group_recipients("team", None, t.id, None, coach.id, db)
        if not recipients:
            continue
        owner = db.get(models.Coach, t.coach_id)
        results.append(schemas.StaffShareTargetOut(
            kind="team",
            label=f"{t.name} — Whole Staff",
            sublabel=f"{len(recipients)} staff" + (f" · {owner.program_name}" if owner else ""),
            team_id=t.id,
            member_count=len(recipients),
        ))

    # ── Program groups (everyone sharing a matching program_name) ────────────
    programs = (
        db.query(models.Coach.program_name)
        .filter(models.Coach.program_name.ilike(like))
        .distinct()
        .limit(10)
        .all()
    )
    for (prog,) in programs:
        if not prog:
            continue
        recipients = _resolve_group_recipients("program", None, None, prog, coach.id, db)
        if not recipients:
            continue
        results.append(schemas.StaffShareTargetOut(
            kind="program",
            label=f"{prog} — Whole Program",
            sublabel=f"{len(recipients)} staff",
            program_name=prog,
            member_count=len(recipients),
        ))

    # ── Individual coaches ───────────────────────────────────────────────────
    coaches = (
        db.query(models.Coach)
        .filter(
            (models.Coach.name.ilike(like)) | (models.Coach.program_name.ilike(like))
        )
        .filter(models.Coach.id != coach.id)
        .limit(15)
        .all()
    )
    for c in coaches:
        results.append(schemas.StaffShareTargetOut(
            kind="coach",
            label=c.name,
            sublabel=f"{c.role or 'staff'} · {c.program_name or ''}".strip(" ·"),
            coach_id=c.id,
            member_count=1,
        ))

    return results


@router.post("/share-group")
def share_with_staff_group(
    body: schemas.StaffGroupShareRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Share a report with a staff target (single coach, whole team, or whole
    program), fanning out to every connected coach with duplicates removed."""
    recipients = _resolve_group_recipients(
        body.kind, body.coach_id, body.team_id, body.program_name, coach.id, db
    )
    if not recipients:
        raise HTTPException(status_code=400, detail="No connected staff to share with")

    frozen = body.frozen_text if (body.frozen_text and not body.allow_regenerate) else None

    count = 0
    for rid in recipients:
        recipient = db.get(models.Coach, rid)
        if not recipient:
            continue
        sr, _ = _upsert_share(db, body.report_type, body.report_id, coach.id,
                              rid, body.allow_regenerate, frozen)
        grant_players_for_share(db, body.report_type, body.report_id, coach, rid)
        _coach_notify(
            db, rid,
            f"Report Shared by {coach.name}",
            f"{coach.name} shared a {body.report_type.replace('_', ' ')} report with you.",
            ref_id=sr.id,
            ntype="staff_report_shared",
            key="notifs.staffReportShared", params={"coach": coach.name, "type": body.report_type},
        )
        count += 1

    db.commit()
    return {"ok": True, "shared_count": count}


@router.post("/share-team")
def share_with_team(
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Share a report with every STAFF member of a team / sub-team (the coaches
    on it), delivered to their staff inbox."""
    team_id = body.get("team_id")
    team = db.get(models.Team, int(team_id)) if team_id else None
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    ids = {team.coach_id}
    ids.update(l.coach_id for l in db.query(models.TeamStaff).filter_by(team_id=team.id).all())
    ids.discard(coach.id)
    if not ids:
        raise HTTPException(status_code=400, detail="This group has no other staff members yet.")
    report_type = str(body.get("report_type") or "team_report")
    report_id = int(body.get("report_id") or 0)
    allow_regenerate = bool(body.get("allow_regenerate"))
    frozen = body.get("frozen_text") if (body.get("frozen_text") and not allow_regenerate) else None
    count = 0
    for rid in ids:
        sr, _ = _upsert_share(db, report_type, report_id, coach.id, rid,
                              allow_regenerate, frozen)
        grant_players_for_share(db, report_type, report_id, coach, rid)
        _coach_notify(
            db, rid,
            f"Report shared by {coach.name}",
            f"{coach.name} shared a {report_type.replace('_', ' ')} report with {team.name}.",
            ref_id=sr.id, ntype="staff_report_shared",
            key="notifs.staffReportSharedTeam",
            params={"coach": coach.name, "type": report_type, "team": team.name},
        )
        count += 1
    db.commit()
    return {"ok": True, "shared_count": count, "team_name": team.name}


@router.get("/inbox", response_model=list[schemas.StaffSharedReportOut])
def staff_inbox(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Every report this coach is on a conversation about — received OR sent.

    A report the coach shared belongs here too. Sending it used to be the end
    of it as far as this list was concerned: the replies came back to a thread
    only the recipient could open, so the person who started the conversation
    was the one person who could not see it.

    One entry per report, not per recipient. Sharing with three coaches makes
    three rows underneath, but it is one report and one conversation, and three
    identical cards is not a better answer than one.
    """
    received = (
        db.query(models.StaffSharedReport)
        .filter_by(recipient_id=coach.id)
        .order_by(models.StaffSharedReport.id.desc())
        .all()
    )
    sent = (
        db.query(models.StaffSharedReport)
        .filter_by(sender_id=coach.id)
        .order_by(models.StaffSharedReport.id.desc())
        .all()
    )
    out = []
    seen_conversations: set[tuple[str, int]] = set()
    for r in received + sent:
        key = (r.report_type, r.report_id)
        if key in seen_conversations:
            continue
        seen_conversations.add(key)
        o = _build_out(r, db)
        o.is_sender = r.sender_id == coach.id
        if o.is_sender:
            # The recipient's own updated copy stays theirs until they approve a
            # request to share it back — the same rule /sent has always applied.
            o.has_update = any(x.updated_report_id is not None
                               for x in _conversation_rows(r, db))
            o.regenerated_text = None
            o.updated_report_id = None
        o.correction_count = (
            db.query(models.SharedReportCorrection)
            .filter_by(shared_id=r.id, coach_id=coach.id, applied=False)
            .count()
        )
        out.append(o)
    # By date, in one list, so a conversation sits where it happened rather
    # than in a separate pile for things the coach happened to start.
    out.sort(key=lambda o: o.created_at, reverse=True)
    return out


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
    out = []
    for r in reports:
        o = _build_out(r, db)
        # The sharer sees the ORIGINAL + comments, but the recipient's updated
        # version stays private until they approve a request — only signal that
        # one exists.
        o.has_update = r.updated_report_id is not None
        o.regenerated_text = None
        o.updated_report_id = None
        out.append(o)
    return out


@router.get("/{shared_id}/comments", response_model=list[schemas.StaffReportCommentOut])
def get_comments(
    shared_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    sr = db.get(models.StaffSharedReport, shared_id)
    if not sr or not _in_conversation(sr, coach.id, db):
        raise HTTPException(status_code=404, detail="Shared report not found")
    # Everyone's replies, not just the ones on this row. Share a report with
    # two coaches and each reply landed in its own thread: the sender saw both
    # and the two recipients saw neither each other's nor, half the time, any
    # sign that a conversation was happening at all.
    ids = [r.id for r in _conversation_rows(sr, db)]
    comments = (db.query(models.StaffReportComment)
                  .filter(models.StaffReportComment.shared_report_id.in_(ids))
                  .order_by(models.StaffReportComment.id).all())
    result = []
    for c in comments:
        out = schemas.StaffReportCommentOut.model_validate(c)
        out.author_name = c.author.name if c.author else ""
        out.target = c.target or "original"
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
    if not sr or not _in_conversation(sr, coach.id, db):
        raise HTTPException(status_code=404, detail="Shared report not found")
    comment = models.StaffReportComment(
        shared_report_id=shared_id,
        author_id=coach.id,
        text=body.text,
        target=(body.target if body.target in ("original", "updated") else "original"),
    )
    db.add(comment)
    db.flush()

    # Everyone else on the conversation, not just the other end of this row —
    # a reply the rest of the staff cannot see is a reply half the room is
    # having a different meeting about.
    rows = _conversation_rows(sr, db)
    others = {r.sender_id for r in rows} | {r.recipient_id for r in rows}
    others.discard(coach.id)
    for other_id in others:
        _coach_notify(
            db, other_id,
            f"New comment from {coach.name}",
            body.text[:120],
            ref_id=shared_id,
            ntype="staff_report_comment",
            key="notifs.staffReportComment", params={"coach": coach.name, "text": body.text[:120]},
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

    report_text = sr.frozen_text or _resolve_report_text(sr.report_type, sr.report_id, db, sr.sender_id)
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
            model=OPUS,
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
        key="notifs.staffReportRegenerated", params={"coach": coach.name, "type": sr.report_type},
    )
    db.commit()
    db.refresh(sr)
    return _build_out(sr, db)


async def _ai_update_report(base_text: str, corrections: list[str]) -> str:
    """Rewrite a report to incorporate all of the recipient's corrections."""
    combined = "\n".join(f"- {c}" for c in corrections if c.strip())
    prompt = (
        "You are a basketball analysis expert. Below is a report followed by corrections "
        "from a staff member. Rewrite the report to fully incorporate ALL the corrections. "
        "Return ONLY the updated report text.\n\n"
        "Do NOT use ## headers, ** bold markers, or ——— / === / --- dividers. "
        "Use plain section titles in ALL CAPS followed by a colon and newline. "
        "Do NOT write 'END OF REPORT' or any closing marker.\n\n"
        f"ORIGINAL REPORT:\n{base_text}\n\nCORRECTIONS:\n{combined}\n\nUPDATED REPORT:"
    )
    import anthropic
    client = anthropic.AsyncAnthropic()
    response = await client.messages.create(
        model=OPUS, max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )
    blocks = [b for b in response.content if hasattr(b, "text")]
    if not blocks:
        raise HTTPException(status_code=500, detail="AI returned no content")
    import re as _re
    return _re.sub(r"\s*END OF REPORT\.?\s*$", "", blocks[0].text.strip(), flags=_re.IGNORECASE).rstrip()


def _create_updated_report(db: Session, coach: models.Coach, sr: models.StaffSharedReport, new_text: str) -> int:
    """Create the recipient's OWN 'Updated ___' record for a shared report, in
    the right table for the report type. Returns the new record id (or the game
    id for a scouting report)."""
    from .evaluations import _parse_grade, _parse_pillar_grades, _parse_list_section
    rt = sr.report_type
    if rt == "eval":
        orig = db.get(models.Evaluation, sr.report_id)
        if not orig:
            raise HTTPException(status_code=404, detail="Original evaluation not found")
        rec = models.Evaluation(
            player_id=orig.player_id, coach_id=coach.id, output_type=orig.output_type,
            report_text=new_text, overall_grade=_parse_grade(new_text),
            pillar_grades=_parse_pillar_grades(new_text),
            green_flags=_parse_list_section(new_text, "GREEN FLAGS"),
            watch_flags=_parse_list_section(new_text, "WATCH FLAGS"),
            key_questions=_parse_list_section(new_text, "KEY QUESTIONS"),
        )
        db.add(rec); db.flush(); return rec.id
    if rt == "training":
        orig = db.get(models.TrainingSession, sr.report_id)
        if not orig:
            raise HTTPException(status_code=404, detail="Original training not found")
        rec = models.TrainingSession(
            player_id=orig.player_id, coach_id=coach.id, program_text=new_text, priorities=orig.priorities,
        )
        db.add(rec); db.flush(); return rec.id
    if rt in ("team_report", "team_training"):
        orig = db.get(models.TeamReport, sr.report_id)
        if not orig:
            raise HTTPException(status_code=404, detail="Original team report not found")
        rec = models.TeamReport(
            coach_id=coach.id, output_type=orig.output_type, focus_prompt=orig.focus_prompt, report_text=new_text,
        )
        db.add(rec); db.flush(); return rec.id
    if rt == "game":
        orig = db.get(models.GameReport, sr.report_id)
        if not orig:
            raise HTTPException(status_code=404, detail="Original game report not found")
        rec = models.GameReport(
            coach_id=coach.id, title=(("Updated: " + orig.title) if orig.title else "Updated Game Report"),
            mode=orig.mode, opponent_name=orig.opponent_name, output_type=orig.output_type, report_text=new_text,
        )
        db.add(rec); db.flush(); return rec.id
    if rt == "game_session":
        game = db.get(models.GameSession, sr.report_id)
        if not game:
            raise HTTPException(status_code=404, detail="Original game not found")
        row = db.query(models.GameScoutingReport).filter_by(game_id=game.id, coach_id=coach.id).first()
        if row:
            row.report_text = new_text
        else:
            db.add(models.GameScoutingReport(game_id=game.id, coach_id=coach.id, report_text=new_text))
        db.flush(); return game.id
    raise HTTPException(status_code=400, detail="This report type can't be updated")


def _apply_updated_report(db: Session, coach: models.Coach, sr: models.StaffSharedReport, new_text: str) -> int:
    """Update the recipient's existing Updated copy in place if they have one,
    else create it. It's their own file, so we keep a single evolving copy."""
    if not sr.updated_report_id:
        return _create_updated_report(db, coach, sr, new_text)
    rt = sr.report_type
    from .evaluations import _parse_grade, _parse_pillar_grades, _parse_list_section
    if rt == "eval":
        rec = db.get(models.Evaluation, sr.updated_report_id)
        if rec:
            rec.report_text = new_text
            rec.overall_grade = _parse_grade(new_text)
            rec.pillar_grades = _parse_pillar_grades(new_text)
            rec.green_flags = _parse_list_section(new_text, "GREEN FLAGS")
            rec.watch_flags = _parse_list_section(new_text, "WATCH FLAGS")
            rec.key_questions = _parse_list_section(new_text, "KEY QUESTIONS")
            return rec.id
    elif rt == "training":
        rec = db.get(models.TrainingSession, sr.updated_report_id)
        if rec:
            rec.program_text = new_text
            return rec.id
    elif rt in ("team_report", "team_training"):
        rec = db.get(models.TeamReport, sr.updated_report_id)
        if rec:
            rec.report_text = new_text
            return rec.id
    elif rt == "game":
        rec = db.get(models.GameReport, sr.updated_report_id)
        if rec:
            rec.report_text = new_text
            return rec.id
    elif rt == "game_session":
        # Scouting is unique per (game, coach), so this upserts in place.
        return _create_updated_report(db, coach, sr, new_text)
    # Record was deleted out from under us — make a fresh one.
    return _create_updated_report(db, coach, sr, new_text)


@router.patch("/corrections/{correction_id}")
def edit_shared_correction(
    correction_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    row = db.get(models.SharedReportCorrection, correction_id)
    if not row or row.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Correction not found")
    if row.applied:
        raise HTTPException(status_code=400, detail="This correction was already applied and can't be edited")
    text = (body.get("correction") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Correction text required")
    row.correction = text
    db.commit()
    return {"id": row.id, "correction": row.correction, "applied": row.applied}


@router.delete("/corrections/{correction_id}")
def delete_shared_correction(
    correction_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    row = db.get(models.SharedReportCorrection, correction_id)
    if not row or row.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Correction not found")
    if row.applied:
        raise HTTPException(status_code=400, detail="This correction was already applied and can't be deleted")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/{shared_id}/corrections")
def list_shared_corrections(
    shared_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    sr = db.get(models.StaffSharedReport, shared_id)
    if not sr or sr.recipient_id != coach.id:
        raise HTTPException(status_code=404, detail="Shared report not found")
    rows = (
        db.query(models.SharedReportCorrection)
        .filter_by(shared_id=shared_id, coach_id=coach.id)
        .order_by(models.SharedReportCorrection.id)
        .all()
    )
    return [{"id": r.id, "correction": r.correction, "applied": r.applied, "created_at": r.created_at} for r in rows]


@router.post("/{shared_id}/corrections")
def add_shared_correction(
    shared_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    sr = db.get(models.StaffSharedReport, shared_id)
    if not sr or sr.recipient_id != coach.id:
        raise HTTPException(status_code=404, detail="Shared report not found")
    if not sr.allow_regenerate:
        raise HTTPException(status_code=403, detail="This share doesn't allow edits")
    text = (body.get("correction") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Correction text required")
    row = models.SharedReportCorrection(shared_id=shared_id, coach_id=coach.id, correction=text)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "correction": row.correction, "applied": row.applied}


@router.post("/{shared_id}/regenerate-mine", response_model=schemas.StaffSharedReportOut)
async def regenerate_mine(
    shared_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Apply & Regenerate: rewrite the shared report with all of my un-applied
    corrections and save the result as my OWN Updated copy (of the right type).
    The sender's original is untouched."""
    sr = db.get(models.StaffSharedReport, shared_id)
    if not sr or sr.recipient_id != coach.id:
        raise HTTPException(status_code=404, detail="Shared report not found")
    if not sr.allow_regenerate:
        raise HTTPException(status_code=403, detail="This share doesn't allow edits")

    feedback = (body.get("feedback") or "").strip()
    if feedback:
        db.add(models.SharedReportCorrection(shared_id=shared_id, coach_id=coach.id, correction=feedback))
        db.commit()
    pending = (
        db.query(models.SharedReportCorrection)
        .filter_by(shared_id=shared_id, coach_id=coach.id, applied=False)
        .order_by(models.SharedReportCorrection.id)
        .all()
    )
    corrections = [p.correction for p in pending]
    if not corrections:
        raise HTTPException(status_code=400, detail="Add at least one correction first")

    # Base off my latest updated copy if I have one, else the shared original.
    # Prefer the frozen (toggle-filtered) copy so regeneration never brings back
    # sections the sharer deselected.
    base = sr.regenerated_text or sr.frozen_text or _resolve_report_text(sr.report_type, sr.report_id, db, sr.sender_id)
    if not base:
        raise HTTPException(status_code=400, detail="No report content to update")

    new_text = await _ai_update_report(base, corrections)
    new_id = _apply_updated_report(db, coach, sr, new_text)
    sr.regenerated_text = new_text
    sr.updated_report_id = new_id
    for p in pending:
        p.applied = True
    # Let the original sharer know their report was regenerated, so they can
    # request the updated copy if they want it.
    if sr.sender_id != coach.id:
        _coach_notify(
            db, sr.sender_id,
            f"Report Regenerated by {coach.name}",
            f"{coach.name} regenerated your shared {sr.report_type.replace('_', ' ')} report.",
            ref_id=sr.id, ntype="staff_report_regenerated",
            key="notifs.staffReportRegenerated", params={"coach": coach.name, "type": sr.report_type},
        )
    db.commit()
    db.refresh(sr)
    return _build_out(sr, db)


@router.post("/{shared_id}/request-updated")
def request_updated(
    shared_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """The original sharer asks the recipient to share back their updated copy."""
    sr = db.get(models.StaffSharedReport, shared_id)
    if not sr or sr.sender_id != coach.id:
        raise HTTPException(status_code=404, detail="Shared report not found")
    _coach_notify(
        db, sr.recipient_id,
        f"{coach.name} requested your updated report",
        f"{coach.name} asked to see your updated version of the {sr.report_type.replace('_', ' ')} report.",
        ref_id=sr.id, ntype="staff_report_request",
        key="notifs.staffReportRequest", params={"coach": coach.name, "type": sr.report_type},
    )
    # Recorded so the recipient's notification can show where the request stands
    # after a reload, rather than offering its buttons again.
    sr.request_status = "pending"
    db.commit()
    return {"ok": True}


@router.post("/{shared_id}/respond-request")
def respond_request(
    shared_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """The recipient approves or rejects a request to share back their updated
    copy. On approve, their updated version is shared to the requester with
    correct/regenerate enabled; on reject, the requester is just notified."""
    sr = db.get(models.StaffSharedReport, shared_id)
    if not sr or sr.recipient_id != coach.id:
        raise HTTPException(status_code=404, detail="Shared report not found")
    approve = bool(body.get("approve"))
    sr.request_status = "approved" if approve else "declined"
    if not approve:
        _coach_notify(
            db, sr.sender_id,
            f"{coach.name} declined your request",
            f"{coach.name} declined to share their updated {sr.report_type.replace('_', ' ')} report.",
            ref_id=sr.id, ntype="staff_report_declined",
        key="notifs.staffReportDeclined", params={"coach": coach.name, "type": sr.report_type},
        )
        db.commit()
        return {"ok": True, "approved": False}
    # Share the recipient's updated copy (or their current version) back —
    # reusing any existing share so a repeated request doesn't duplicate it.
    report_id = sr.updated_report_id or sr.report_id
    new_share, _ = _upsert_share(db, sr.report_type, report_id, coach.id,
                                 sr.sender_id, True, None)
    _coach_notify(
        db, sr.sender_id,
        f"{coach.name} shared their updated report",
        f"{coach.name} shared their updated {sr.report_type.replace('_', ' ')} report with you.",
        ref_id=new_share.id, ntype="staff_report_shared",
        key="notifs.staffReportUpdatedShared", params={"coach": coach.name, "type": sr.report_type},
    )
    db.commit()
    return {"ok": True, "approved": True, "shared_id": new_share.id}


@router.post("/{shared_id}/adopt", response_model=schemas.EvalOut)
def adopt_shared_eval(
    shared_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Make an edited/regenerated copy of a shared player eval MY OWN eval.

    Only allowed when the sender permitted regeneration. Creates a brand-new
    Evaluation owned by me from the given text (re-parsing the BIM grade/pillars
    so the score reflects my edits). The author's original stays untouched. If I
    later share this to the player, it counts as my own input in their
    composite — a second coach's view — because it's a distinct evaluation."""
    sr = db.get(models.StaffSharedReport, shared_id)
    if not sr or sr.recipient_id != coach.id:
        raise HTTPException(status_code=404, detail="Shared report not found")
    if sr.report_type != "eval":
        raise HTTPException(status_code=400, detail="Only player evaluations can be adopted")
    if not sr.allow_regenerate:
        raise HTTPException(status_code=403, detail="This share doesn't allow edits")
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Report text required")
    orig = db.get(models.Evaluation, sr.report_id)
    if not orig:
        raise HTTPException(status_code=404, detail="Original evaluation not found")

    from .evaluations import _parse_grade, _parse_pillar_grades, _parse_list_section
    new_eval = models.Evaluation(
        player_id=orig.player_id,
        coach_id=coach.id,
        output_type=orig.output_type,
        report_text=text,
        overall_grade=_parse_grade(text),
        pillar_grades=_parse_pillar_grades(text),
        green_flags=_parse_list_section(text, "GREEN FLAGS"),
        watch_flags=_parse_list_section(text, "WATCH FLAGS"),
        key_questions=_parse_list_section(text, "KEY QUESTIONS"),
    )
    db.add(new_eval)
    db.commit()
    db.refresh(new_eval)
    return new_eval


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

    # Preserve the frozen snapshot when forwarding a non-regenerable copy.
    fwd_frozen = sr.frozen_text if (sr.frozen_text and not body.allow_regenerate) else None

    new_sr = models.StaffSharedReport(
        report_type=sr.report_type,
        report_id=sr.report_id,
        sender_id=coach.id,
        recipient_id=body.recipient_id,
        allow_regenerate=body.allow_regenerate,
        frozen_text=fwd_frozen,
    )
    db.add(new_sr)
    db.flush()

    _coach_notify(
        db, body.recipient_id,
        f"Report Forwarded by {coach.name}",
        f"{coach.name} forwarded a {sr.report_type.replace('_', ' ')} report to you.",
        ref_id=new_sr.id,
        ntype="staff_report_shared",
        key="notifs.staffReportForwarded", params={"coach": coach.name, "type": sr.report_type},
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
