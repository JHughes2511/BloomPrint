"""Staff-to-staff direct & group messaging."""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_coach
from .. import emails, models, notify

router = APIRouter(prefix="/staff-messages", tags=["staff-messages"])


def _member_ids(db: Session, cid: int) -> list[int]:
    return [m.coach_id for m in db.query(models.ConversationMember).filter_by(conversation_id=cid).all()]


def _conversation_summary(db: Session, conv: models.Conversation, me_id: int) -> dict:
    members = db.query(models.ConversationMember).filter_by(conversation_id=conv.id).all()
    member_ids = [m.coach_id for m in members]
    coaches = {c.id: c for c in db.query(models.Coach).filter(models.Coach.id.in_(member_ids)).all()} if member_ids else {}
    others = [coaches[i].name for i in member_ids if i != me_id and i in coaches]
    last = (
        db.query(models.StaffMessage)
        .filter_by(conversation_id=conv.id)
        .order_by(models.StaffMessage.id.desc())
        .first()
    )
    mine = next((m for m in members if m.coach_id == me_id), None)
    unread = 0
    if last:
        unread = (
            db.query(models.StaffMessage)
            .filter(
                models.StaffMessage.conversation_id == conv.id,
                models.StaffMessage.sender_id != me_id,
                models.StaffMessage.id > (mine.last_read_message_id or 0) if mine else True,
            )
            .count()
        )
    title = conv.title or (", ".join(others) if others else "Conversation")
    preview = ""
    if last:
        preview = last.text or "[attachment]"
    return {
        "id": conv.id,
        "is_group": bool(conv.is_group),
        "title": title,
        "members": [{"id": i, "name": coaches[i].name} for i in member_ids if i in coaches],
        "last_text": preview,
        "last_at": (last.created_at if last else conv.last_at),
        "unread": unread,
        "kind": "conversation",
    }


@router.get("")
def list_conversations(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    my_conv_ids = [m.conversation_id for m in db.query(models.ConversationMember).filter_by(coach_id=coach.id).all()]
    if not my_conv_ids:
        return []
    convs = (
        db.query(models.Conversation)
        .filter(models.Conversation.id.in_(my_conv_ids))
        .order_by(models.Conversation.last_at.desc())
        .all()
    )
    return [_conversation_summary(db, c, coach.id) for c in convs]


@router.post("")
def create_conversation(
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    member_ids = [int(i) for i in (body.get("member_ids") or []) if int(i) != coach.id]
    if not member_ids:
        raise HTTPException(status_code=400, detail="Pick at least one staff member to message.")
    is_group = bool(body.get("is_group")) or len(member_ids) > 1
    title = (body.get("title") or "").strip() or None

    # Reuse an existing 1:1 conversation between the two coaches.
    if not is_group and len(member_ids) == 1:
        other = member_ids[0]
        mine = {m.conversation_id for m in db.query(models.ConversationMember).filter_by(coach_id=coach.id).all()}
        theirs = {m.conversation_id for m in db.query(models.ConversationMember).filter_by(coach_id=other).all()}
        for cid in (mine & theirs):
            conv = db.get(models.Conversation, cid)
            if conv and not conv.is_group and len(_member_ids(db, cid)) == 2:
                return _conversation_summary(db, conv, coach.id)

    conv = models.Conversation(is_group=is_group, title=title, created_by=coach.id)
    db.add(conv)
    db.flush()
    for cid in {coach.id, *member_ids}:
        db.add(models.ConversationMember(conversation_id=conv.id, coach_id=cid))
    db.commit()
    db.refresh(conv)
    return _conversation_summary(db, conv, coach.id)


def _require_member(db: Session, cid: int, coach_id: int) -> models.Conversation:
    conv = db.get(models.Conversation, cid)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if coach_id not in _member_ids(db, cid):
        raise HTTPException(status_code=403, detail="Not a member of this conversation")
    return conv


def _message_out(db: Session, m: models.StaffMessage, names: dict) -> dict:
    atts = db.query(models.StaffMessageAttachment).filter_by(message_id=m.id).all()
    deleted = m.deleted_at is not None
    return {
        "id": m.id,
        "sender_id": m.sender_id,
        "sender_name": names.get(m.sender_id, "Staff"),
        # A deleted message keeps its place in the conversation so replies to
        # it still read, but not its words.
        "text": None if deleted else m.text,
        "created_at": m.created_at,
        "parent_id": m.parent_id,
        "edited": m.edited_at is not None,
        "deleted": deleted,
        "attachments": [] if deleted else [{
            "id": a.id, "kind": a.kind, "report_type": a.report_type, "report_id": a.report_id,
            "report_title": a.report_title, "report_text": a.report_text, "data": a.data, "name": a.name,
        } for a in atts],
    }


@router.get("/{cid}")
def get_conversation(
    cid: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    conv = _require_member(db, cid, coach.id)
    member_ids = _member_ids(db, cid)
    names = {c.id: c.name for c in db.query(models.Coach).filter(models.Coach.id.in_(member_ids)).all()}
    msgs = db.query(models.StaffMessage).filter_by(conversation_id=cid).order_by(models.StaffMessage.id.asc()).all()
    # Mark read up to the last message.
    if msgs:
        mine = db.query(models.ConversationMember).filter_by(conversation_id=cid, coach_id=coach.id).first()
        if mine:
            mine.last_read_message_id = msgs[-1].id
            db.commit()
    return {
        "id": conv.id,
        "is_group": bool(conv.is_group),
        "title": conv.title or ", ".join(names[i] for i in member_ids if i != coach.id and i in names) or "Conversation",
        "members": [{"id": i, "name": names.get(i, "Staff")} for i in member_ids],
        "messages": [_message_out(db, m, names) for m in msgs],
    }


@router.post("/{cid}/messages")
def send_message(
    cid: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    conv = _require_member(db, cid, coach.id)
    text = (body.get("text") or "").strip() or None
    attachments = body.get("attachments") or []
    if not text and not attachments:
        raise HTTPException(status_code=400, detail="Nothing to send.")
    # Replying to a particular message, when the sender picked one. It has to
    # belong to this conversation: a reply quoting a message from somewhere
    # else would show the room text none of them can otherwise see.
    parent_id = body.get("parent_id")
    parent = db.get(models.StaffMessage, parent_id) if parent_id else None
    if parent is not None and parent.conversation_id != cid:
        raise HTTPException(status_code=400, detail="That message is not in this conversation.")
    msg = models.StaffMessage(conversation_id=cid, sender_id=coach.id, text=text,
                              parent_id=parent.id if parent else None)
    db.add(msg)
    db.flush()
    for a in attachments[:10]:
        db.add(models.StaffMessageAttachment(
            message_id=msg.id,
            kind=str(a.get("kind") or "report"),
            report_type=a.get("report_type"),
            report_id=a.get("report_id"),
            report_title=a.get("report_title"),
            report_text=a.get("report_text"),
            data=a.get("data"),
            name=a.get("name"),
        ))
    conv.last_at = datetime.utcnow()
    coach.last_active = datetime.utcnow()  # communication counts as activity
    # Notify the other members.
    preview = text or "[attachment]"
    params = {"coach": coach.name, "preview": preview[:120]}
    # A named group says which thread; a one-to-one is already identified by
    # who sent it, and "Marcus in Marcus" would be worse than saying nothing.
    thread = (conv.title or "").strip() if conv.is_group else ""
    key = "notifs.staffMessage"
    if thread:
        key = "notifs.staffMessageGroup"
        params["item"] = thread
    recipients = [mid for mid in _member_ids(db, cid) if mid != coach.id]
    for mid in recipients:
        db.add(models.PlayerNotification(
            coach_id=mid,
            type="staff_message",
            title=f"Message from {coach.name}",
            body=preview[:120],
            i18n_key=key, i18n_params=params,
            ref_id=cid,
        ))
    db.commit()
    for mid in recipients:
        notify.coach_notification(db.get(models.Coach, mid), key, params,
                                  link=emails.link_to(f"/home/staff/{cid}"))
    names = {c.id: c.name for c in db.query(models.Coach).filter(models.Coach.id.in_(_member_ids(db, cid))).all()}
    return _message_out(db, msg, names)


@router.post("/{cid}/read")
def mark_read(
    cid: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    _require_member(db, cid, coach.id)
    last = db.query(models.StaffMessage).filter_by(conversation_id=cid).order_by(models.StaffMessage.id.desc()).first()
    mine = db.query(models.ConversationMember).filter_by(conversation_id=cid, coach_id=coach.id).first()
    if last and mine:
        mine.last_read_message_id = last.id
        db.commit()
    return {"ok": True}


@router.patch("/{cid}/messages/{mid}")
def edit_message(
    cid: int,
    mid: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Rewrite something you sent.

    Your own only. A conversation is a record several people are reading, and
    letting one of them rewrite another's words would make it useless as one.
    """
    _require_member(db, cid, coach.id)
    msg = db.get(models.StaffMessage, mid)
    if not msg or msg.conversation_id != cid:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.sender_id != coach.id:
        raise HTTPException(status_code=403, detail="That is not your message.")
    if msg.deleted_at is not None:
        raise HTTPException(status_code=400, detail="That message was deleted.")
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="A message cannot be empty.")
    msg.text = text
    msg.edited_at = datetime.utcnow()
    db.commit()
    names = {c.id: c.name for c in db.query(models.Coach).filter(models.Coach.id.in_(_member_ids(db, cid))).all()}
    return _message_out(db, msg, names)


@router.delete("/{cid}/messages/{mid}")
def delete_message(
    cid: int,
    mid: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Take back something you sent.

    Recorded rather than performed: a message somebody has replied to is the
    top of a thread, and removing the row takes the replies with it. The words
    and any attachments go; the place it occupied stays.
    """
    _require_member(db, cid, coach.id)
    msg = db.get(models.StaffMessage, mid)
    if not msg or msg.conversation_id != cid:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.sender_id != coach.id:
        raise HTTPException(status_code=403, detail="That is not your message.")
    msg.deleted_at = datetime.utcnow()
    msg.text = None
    for a in db.query(models.StaffMessageAttachment).filter_by(message_id=msg.id).all():
        db.delete(a)
    db.commit()
    names = {c.id: c.name for c in db.query(models.Coach).filter(models.Coach.id.in_(_member_ids(db, cid))).all()}
    return _message_out(db, msg, names)
