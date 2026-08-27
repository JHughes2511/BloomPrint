"""Every message that goes out, recorded, and retried when it does not.

WHAT THIS IS FOR

Sending has always been fire-and-forget: a share must not fail because a mail
provider is having a bad minute. That is the right call and it left two things
unanswerable. Whether a message actually went out, which the logs answered only
if somebody had kept them. And what to do about one that did not, which was
nothing at all — a blip lost a message permanently, and silently.

Now each send writes a row first and updates it with what happened. A failure
is retried on a widening delay; the digest thread already wakes on a timer and
does the retrying, because a second timer for this would be a second thing to
get wrong.

WHAT IS STORED

The rendered message, not the ingredients. A retry then sends the very bytes
that failed rather than re-rendering from a world that has moved on: a comment
edited, a name changed, a report un-shared. It also means a retry can only fail
for the reason the first attempt did.

Successful rows are pruned after a month. The failures stay: they are the ones
worth being able to look at.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from . import models
from .database import SessionLocal
from .mailer import mail_from, try_send

log = logging.getLogger(__name__)

# How long to wait before each retry. Widening, because the failures worth
# retrying are either a moment long or an hour long and rarely in between.
BACKOFF = [timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=25),
           timedelta(hours=2), timedelta(hours=10)]
MAX_ATTEMPTS = len(BACKOFF)

# A sent message is kept long enough to answer "did that go out?" about
# something somebody noticed this month, and no longer.
KEEP_SENT = timedelta(days=30)

# Nothing to retry against. Retrying a message five times because the server
# has no mail provider configured is five identical rows saying so.
NO_PROVIDER = "no email provider configured"


def _attempt(db, row: models.EmailSend) -> bool:
    """Try this row once and record the outcome. Never raises."""
    try:
        ok, reason = try_send(row.to_address, row.subject, row.body, row.html,
                              from_addr=mail_from(), reply_to=row.reply_to)
    except Exception as exc:
        ok, reason = False, f"{type(exc).__name__}: {exc}"

    now = datetime.utcnow()
    row.attempts = int(row.attempts or 0) + 1
    if ok:
        row.status = "sent"
        row.sent_at = now
        row.next_attempt_at = None
        row.last_error = None
    else:
        row.last_error = reason
        if NO_PROVIDER in (reason or "") or row.attempts >= MAX_ATTEMPTS:
            # Either nothing can come of trying, or enough has been tried.
            row.status = "abandoned"
            row.next_attempt_at = None
            if NO_PROVIDER not in (reason or ""):
                log.warning("Giving up on email to %s (%s) after %s attempts: %s",
                            row.to_address, row.subject, row.attempts, reason)
        else:
            row.status = "failed"
            row.next_attempt_at = now + BACKOFF[row.attempts - 1]
    db.commit()
    return ok


def send(to: str, subject: str, body: str, html: str | None = None, *,
         kind: str | None = None, audience: str | None = None,
         user_id: int | None = None, reply_to: str | None = None) -> bool:
    """Record a message and send it. Returns whether it went out first time.

    Its own session: callers are on a thread pool with no transaction of their
    own, and a message must be recorded even if everything else about the
    request that caused it has already finished.
    """
    if not to:
        return False
    db = SessionLocal()
    try:
        row = models.EmailSend(
            to_address=to, subject=subject, body=body, html=html,
            reply_to=reply_to, kind=kind, audience=audience, user_id=user_id,
            status="failed", attempts=0,
        )
        db.add(row)
        db.commit()
        return _attempt(db, row)
    except Exception:
        # A message that cannot even be recorded must not break its caller.
        # Sent anyway, unrecorded, because arriving matters more than being
        # written down.
        log.warning("Could not record an email to %s; sending unrecorded", to,
                    exc_info=True)
        try:
            ok, _ = try_send(to, subject, body, html, from_addr=mail_from(),
                             reply_to=reply_to)
            return ok
        except Exception:
            return False
    finally:
        db.close()


def retry_due(limit: int = 50) -> int:
    """Retry what is due. Returns how many went out this time.

    Claimed by stamping next_attempt_at forward before attempting, in an update
    that only touches rows still due, so two processes cannot both retry the
    same message.
    """
    now = datetime.utcnow()
    done = 0
    db = SessionLocal()
    try:
        rows = (db.query(models.EmailSend)
                .filter(models.EmailSend.status == "failed",
                        models.EmailSend.next_attempt_at.isnot(None),
                        models.EmailSend.next_attempt_at <= now)
                .order_by(models.EmailSend.next_attempt_at)
                .limit(limit)
                .all())
        for row in rows:
            claimed = (db.query(models.EmailSend)
                       .filter(models.EmailSend.id == row.id,
                               models.EmailSend.next_attempt_at <= now)
                       .update({"next_attempt_at": now + BACKOFF[-1]},
                               synchronize_session=False))
            db.commit()
            if not claimed:
                continue
            db.refresh(row)
            try:
                if _attempt(db, row):
                    done += 1
            except Exception:
                db.rollback()
                log.warning("Retry failed for email %s", row.id, exc_info=True)
    finally:
        db.close()
    return done


def prune(now: datetime | None = None) -> int:
    """Forget the messages that arrived. Returns how many rows went."""
    cutoff = (now or datetime.utcnow()) - KEEP_SENT
    db = SessionLocal()
    try:
        n = (db.query(models.EmailSend)
             .filter(models.EmailSend.status == "sent",
                     models.EmailSend.created_at < cutoff)
             .delete(synchronize_session=False))
        db.commit()
        return int(n or 0)
    finally:
        db.close()
