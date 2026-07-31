"""In-app feedback: capture it, notify, then aggregate into priorities.

Two deliberately separate steps.

Submitting stores the row, emails a copy inwards, and sends the coach a
receipt. No AI runs here — a coach tapping Send should not wait on a model
call, and a model outage must not lose their words.

The digest is where the AI earns its place: it reads everything not yet
digested, groups the duplicates, and returns a ranked list separating what's
broken from what's merely wanted. Ten reports of the same confusing button are
one problem, and only something that reads all of them at once can say so.
"""
import json
import os
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..auth import get_current_coach
from .. import models
from ..mailer import send_email, feedback_to, feedback_from, mail_from
from ..feedback_emails import ack_message

router = APIRouter(prefix="/feedback", tags=["feedback"])

MAX_FEEDBACK_CHARS = 4000


class FeedbackCreate(BaseModel):
    text: str
    screen: str | None = None
    app_version: str | None = None
    platform: str | None = None


def _notify(row_id: int) -> None:
    """Email the feedback inwards, and send the coach a receipt.

    Runs in the background — the coach's tap shouldn't wait on two SMTP round
    trips. Each send is independent: a failure on one must not skip the other.
    """
    db = SessionLocal()
    # Read once into plain values. The receipt is sent after the notification's
    # error handling, which may have rolled the session back — reaching into
    # ORM objects at that point would raise and silently skip the receipt.
    coach_email: str | None = None
    ack_language: str | None = None
    ack_text: str | None = None
    try:
        row = db.get(models.Feedback, row_id)
        if not row:
            return
        coach = db.get(models.Coach, row.coach_id) if row.coach_id else None
        coach_email = coach.email if coach else None
        ack_language, ack_text = row.language, row.text
        who = f"{coach.name} <{coach.email}>" if coach else "Unknown coach"
        context = " · ".join(x for x in [row.screen, row.platform, row.app_version, row.language] if x)
        body = (
            f"{row.text}\n\n"
            f"—\n"
            f"From: {who}\n"
            f"Context: {context or 'not reported'}\n"
            f"Received: {row.created_at:%Y-%m-%d %H:%M} UTC\n"
            f"Feedback #{row.id}\n"
        )
        subject = f"BloomPrint feedback — {row.text.strip()[:60]}"
        # Sent FROM the feedback mailbox so it isn't delivered to the address it
        # was sent from, which receiving servers reject as spoofing. Reply-To is
        # the coach, so answering the notification reaches them directly.
        sent = send_email(
            feedback_to(), subject, body,
            from_addr=feedback_from(),
            reply_to=coach_email,
        )
        if sent:
            row.emailed = True
            db.commit()
    except Exception:
        # Never let the notification path surface as a failed submission; the
        # row is already saved and the digest will still pick it up.
        db.rollback()

    # The coach's receipt is a separate send: if the internal notification
    # failed, they should still learn their feedback landed.
    try:
        if coach_email and ack_text:
            ack_subject, ack_body = ack_message(ack_language, ack_text)
            send_email(
                coach_email, ack_subject, ack_body,
                from_addr=mail_from(),
                # noreply@ can't take replies, so point answers at the mailbox
                # that can — otherwise a coach replying is talking to nobody.
                reply_to=feedback_to(),
            )
    except Exception:
        pass
    finally:
        db.close()


@router.post("")
def submit_feedback(
    body: FeedbackCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write something first.")
    row = models.Feedback(
        coach_id=coach.id,
        text=text[:MAX_FEEDBACK_CHARS],
        screen=body.screen,
        app_version=body.app_version,
        platform=body.platform,
        # Recorded so a report written in Spanish is read as Spanish rather than
        # mistaken for a broken translation.
        language=coach.preferred_language or "en",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    background.add_task(_notify, row.id)
    return {"ok": True, "id": row.id}


DIGEST_SCHEMA = """Return ONLY JSON, no prose, in exactly this shape:
{
  "themes": [
    {
      "title": "short name for the problem",
      "category": "bug" | "confusing" | "feature" | "praise" | "other",
      "priority": "must_have" | "nice_to_have",
      "count": <how many reports are about this>,
      "ids": [<feedback ids in this theme>],
      "detail": "what is actually happening, in one or two sentences",
      "suggested_fix": "concrete next action"
    }
  ]
}"""


def _digest_prompt(rows: list[models.Feedback]) -> str:
    items = "\n\n".join(
        f"#{r.id} [{r.screen or 'unknown screen'} · {r.platform or '?'} · {r.language or 'en'}]\n{r.text}"
        for r in rows
    )
    return (
        "You are triaging user feedback for BloomPrint, a basketball coaching app.\n\n"
        "Group the reports below into themes. Reports describing the same underlying "
        "problem belong to ONE theme even when worded differently — that grouping is "
        "the point of this exercise.\n\n"
        "Rank must_have above nice_to_have. Treat as must_have: anything broken, "
        "anything blocking a coach from finishing a task, anything losing data. "
        "Treat as nice_to_have: polish, preferences, and additions to something that "
        "already works.\n\n"
        "Feedback may be written in any language; read it in that language and write "
        "your output in English.\n\n"
        f"{DIGEST_SCHEMA}\n\n"
        f"FEEDBACK:\n{items}"
    )


def _render_digest(themes: list[dict], total: int) -> tuple[str, str]:
    must = [t for t in themes if t.get("priority") == "must_have"]
    nice = [t for t in themes if t.get("priority") != "must_have"]

    def section(title: str, group: list[dict]) -> str:
        if not group:
            return f"{title}\n  (none)\n"
        out = [title]
        for t in sorted(group, key=lambda x: -(x.get("count") or 0)):
            ids = ", ".join(f"#{i}" for i in (t.get("ids") or []))
            out.append(
                f"  • [{t.get('category', 'other')}] {t.get('title', 'Untitled')}"
                f"  ({t.get('count', 0)} report(s): {ids})\n"
                f"    {t.get('detail', '')}\n"
                f"    → {t.get('suggested_fix', '')}"
            )
        return "\n".join(out) + "\n"

    text = (
        f"{total} new piece(s) of feedback, grouped into {len(themes)} theme(s).\n\n"
        + section("MUST HAVE", must)
        + "\n"
        + section("NICE TO HAVE", nice)
    )
    subject = f"BloomPrint feedback digest — {len(must)} must-have, {len(nice)} nice-to-have"
    return subject, text


@router.post("/digest")
def build_digest(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
    limit: int = 200,
):
    """Categorise everything not yet digested and email the priorities.

    Safe to run on a schedule: rows are marked as they're included, so nothing
    is triaged twice and a run with nothing new is a no-op.
    """
    rows = (
        db.query(models.Feedback)
        .filter(models.Feedback.digested_at.is_(None))
        .order_by(models.Feedback.id)
        .limit(limit)
        .all()
    )
    if not rows:
        return {"ok": True, "count": 0, "themes": [], "message": "No new feedback."}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured.")

    try:
        import anthropic
        client = anthropic.Anthropic()
        resp = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=8000,
            messages=[{"role": "user", "content": _digest_prompt(rows)}],
        )
        raw = "".join(b.text for b in resp.content if hasattr(b, "text")).strip()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not categorise feedback: {exc}")

    # Models sometimes wrap JSON in a code fence despite being asked not to.
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        themes = json.loads(raw).get("themes", [])
    except Exception:
        raise HTTPException(status_code=502, detail="Categorisation returned unreadable output.")

    # Write the theme back onto each row so a single report can be looked up
    # later without re-running the whole digest.
    by_id = {r.id: r for r in rows}
    for t in themes:
        for fid in t.get("ids") or []:
            row = by_id.get(fid)
            if row:
                row.category = t.get("category")
                row.priority = t.get("priority")
                row.summary = t.get("title")
    now = datetime.utcnow()
    for r in rows:
        r.digested_at = now
    db.commit()

    subject, text = _render_digest(themes, len(rows))
    sent = send_email(feedback_to(), subject, text)
    return {"ok": True, "count": len(rows), "themes": themes, "emailed": sent}


@router.get("")
def list_feedback(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
    limit: int = 100,
):
    """This coach's own submissions — so they can see what they've reported."""
    rows = (
        db.query(models.Feedback)
        .filter_by(coach_id=coach.id)
        .order_by(models.Feedback.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id, "text": r.text, "screen": r.screen,
            "category": r.category, "priority": r.priority,
            "created_at": r.created_at,
        }
        for r in rows
    ]
