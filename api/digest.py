"""The hourly digest: comments and replies, batched instead of one mail each.

WHY ONLY THESE EVENTS

A report being shared happens once and is worth interrupting someone for. A
comment is the opposite: a coach and a player working through one training
program produce six of them in four minutes, and six emails about a
conversation both people are already having is how a sender teaches its readers
to filter the domain. So those events queue, and leave together.

The line is frequency, not importance. Nothing here is quieter than it was: the
in-app notification is written immediately either way, and the digest carries
the same words the single email would have carried.

HOW IT RUNS

A digest comes due when the oldest item in someone's queue is an hour old.
Queueing an item tells api/scheduler.py that moment, and the scheduler's
thread sleeps until then. It used to wake every five minutes to look instead,
which kept the database from ever going to sleep and ran through its plan's
allowance; see the scheduler for that story.

A row is claimed by stamping sent_at BEFORE the message is built, in an update
that only touches rows still unclaimed. Two processes flushing at the same
moment — two replicas, or a boot overlapping a running one — cannot both take
the same row, and the worst case is a batch that is claimed and then fails to
send, which loses a digest rather than sending it twice.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from . import emails, models, outbox, scheduler
from .database import SessionLocal
from .mailer import contact_email, mail_from, try_send

log = logging.getLogger(__name__)

# How long a queued comment waits for company before its digest goes out.
WINDOW = timedelta(hours=1)


# One person's digest is not a mailing list. A thread that ran away would
# otherwise produce a message with hundreds of lines in it; the rest stay
# queued and go out in the next one.
MAX_LINES = 40


def queue(audience: str, user_id: int, key: str, params: dict | None = None,
          link: str | None = None) -> None:
    """Put one notification in the digest instead of sending it now.

    Its own session, for the same reason notify's preference lookup has one:
    the caller is mid-transaction and committing theirs here would commit
    whatever else they had half-written.
    """
    # Stamped here rather than left to the column default, so the moment it
    # comes due is known without reading the row back.
    now = datetime.utcnow()
    db = SessionLocal()
    try:
        db.add(models.PendingNotification(
            audience=audience, user_id=user_id, i18n_key=key,
            params=dict(params or {}), link=link, created_at=now,
        ))
        db.commit()
        # After the commit, so that when the scheduler wakes and reads the
        # queue, this row is in it.
        scheduler.wake_at(now + WINDOW)
    except Exception:
        db.rollback()
        # A digest that fails to queue must not break the event that caused it.
        # The in-app notification is already written.
        log.warning("Could not queue %s for %s #%s", key, audience, user_id,
                    exc_info=True)
    finally:
        db.close()


def _due(db, now: datetime) -> list[tuple[str, int]]:
    """Whose queue has waited long enough, as (audience, user_id)."""
    cutoff = now - WINDOW
    rows = (
        db.query(models.PendingNotification.audience,
                 models.PendingNotification.user_id)
        .filter(models.PendingNotification.sent_at.is_(None),
                models.PendingNotification.created_at <= cutoff)
        .distinct()
        .all()
    )
    return [(a, u) for a, u in rows]


def _claim(db, audience: str, user_id: int, now: datetime) -> list[models.PendingNotification]:
    """Take this person's queued rows, so nobody else can send them.

    Read then stamped in one transaction, with the unclaimed filter repeated on
    the update: a row another flush took between the read and the write is not
    touched, and is simply not in what this one sends.
    """
    rows = (
        db.query(models.PendingNotification)
        .filter_by(audience=audience, user_id=user_id)
        .filter(models.PendingNotification.sent_at.is_(None))
        .order_by(models.PendingNotification.created_at)
        .limit(MAX_LINES)
        .all()
    )
    if not rows:
        return []
    ids = [r.id for r in rows]
    taken = (
        db.query(models.PendingNotification)
        .filter(models.PendingNotification.id.in_(ids),
                models.PendingNotification.sent_at.is_(None))
        .update({"sent_at": now}, synchronize_session=False)
    )
    db.commit()
    if not taken:
        return []
    return rows


def _account(db, audience: str, user_id: int):
    model = models.Coach if audience == "coach" else models.PlayerUser
    return db.get(model, user_id)


def flush_once() -> int:
    """Send every digest that has come due. Returns how many went out."""
    from . import notify

    now = datetime.utcnow()
    sent = 0
    db = SessionLocal()
    try:
        for audience, user_id in _due(db, now):
            try:
                rows = _claim(db, audience, user_id, now)
                if not rows:
                    continue
                account = _account(db, audience, user_id)
                if account is None or not account.email:
                    continue
                token, opted_out = notify._preference(audience, user_id)
                if opted_out:
                    # Claimed and dropped on purpose: they are no longer
                    # queued, and nothing arrives.
                    continue
                lang = getattr(account, "preferred_language", None)
                items = [(r.i18n_key, r.params or {}, r.link) for r in rows]
                rendered = emails.render_digest(items, lang, token=token)
                if rendered is None:
                    continue
                subject, body = rendered
                try:
                    html = emails.render_digest_html(items, lang, token=token)
                except Exception:
                    log.warning("Could not lay out a digest; sending as text",
                                exc_info=True)
                    html = None
                if outbox.send(account.email, subject, body, html,
                               kind="digest", audience=audience,
                               user_id=user_id, reply_to=contact_email()):
                    sent += 1
            except Exception:
                log.warning("Could not send a digest to %s #%s", audience,
                            user_id, exc_info=True)
    finally:
        db.close()
    return sent


def start() -> None:
    """Begin flushing. Kept so existing callers still work; see scheduler."""
    scheduler.start()
