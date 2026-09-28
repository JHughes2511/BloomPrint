"""Waking up to send email only when there is email to send.

WHY THIS REPLACED A TIMER

The digest used to be flushed by a thread that woke every five minutes and ran
three queries, whether or not anything was queued. The database is a Neon
Postgres, which bills for the time it is awake and puts itself to sleep after a
few minutes with no queries. Five minutes of silence never came, so it never
slept: from the day the digest shipped it ran around the clock, used up the
plan's compute allowance, and the database started refusing every connection.
Sign-in, and everything else, went down with it.

So this does not poll. The process already knows the two moments there will be
work, because it is the one creating them:

  a comment queued for the digest comes due an hour after it was queued;
  an email that failed to send comes due at the retry time it was given.

Whoever creates that work calls wake_at() with the moment, and the thread
sleeps until the earliest one it has been told about. With nothing queued it
sleeps indefinitely and touches no database at all.

WHAT THE DATABASE IS STILL ASKED, AND WHEN

Once at boot, to pick up whatever was queued before a restart or a deploy. The
database is awake then regardless, because the app has just connected to it.

Once after each pass that did real work, to find the next thing due, because a
pass can leave work behind: a digest is capped at forty lines and the rest wait
for the next one, and a retry that fails again is due later. The database is
awake then too, having just been used.

Never on a timer, and never when idle.

Pruning old sent mail rides along with those passes at most once a day, rather
than on a timer of its own. When nothing is being sent, nothing is being added
to prune.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

# The least time between two passes that touch the database. A backstop, not a
# schedule: work left over from a pass, like a digest past its forty-line cap,
# is due immediately, and this is what stops that from becoming a tight loop.
MIN_GAP = timedelta(seconds=30)

# How often old sent mail may be pruned, piggybacked on passes that happen
# anyway.
PRUNE_EVERY = timedelta(hours=24)

THREAD_NAME = "email-scheduler"

_cond = threading.Condition()
_next: datetime | None = None
_last_prune: datetime | None = None
_started = False


def wake_at(when: datetime | None) -> None:
    """There will be work at `when`. Touches no database.

    Keeps only the earliest moment it has been told, and wakes the thread if
    that moment moved earlier. Called by the code that creates the work, after
    it has committed, so that anything the thread then reads from the database
    already includes it.
    """
    global _next
    if when is None:
        return
    with _cond:
        if _next is None or when < _next:
            _next = when
            _cond.notify()


def next_wake() -> datetime | None:
    """The earliest moment the thread will next touch the database, if any."""
    with _cond:
        return _next


def _next_due(db) -> datetime | None:
    """When the earliest queued thing comes due, read from the database.

    Two aggregate queries. Only called at boot and straight after a pass, both
    moments when the database is already awake.
    """
    from sqlalchemy import func

    from . import models
    from .digest import WINDOW

    oldest = (db.query(func.min(models.PendingNotification.created_at))
              .filter(models.PendingNotification.sent_at.is_(None))
              .scalar())
    retry = (db.query(func.min(models.EmailSend.next_attempt_at))
             .filter(models.EmailSend.status == "failed",
                     models.EmailSend.next_attempt_at.isnot(None))
             .scalar())
    due = [t for t in ((oldest + WINDOW) if oldest else None, retry) if t]
    return min(due) if due else None


def _refresh(*, prune: bool = False) -> None:
    """Learn the next due moment from the database, and prune if it is time."""
    global _last_prune
    from . import outbox
    from .database import SessionLocal

    now = datetime.utcnow()
    db = SessionLocal()
    try:
        due = _next_due(db)
    finally:
        db.close()
    if due is not None:
        # Work already overdue is still not done this instant: MIN_GAP keeps
        # a batch that is only partly sent from looping without pause.
        wake_at(max(due, now + MIN_GAP))
    if prune or _last_prune is None or now - _last_prune >= PRUNE_EVERY:
        try:
            outbox.prune(now)
        except Exception:
            log.warning("Email log prune failed", exc_info=True)
        _last_prune = now


def _sleep_until_due() -> None:
    """Block until the earliest known moment arrives. Forever if there is none."""
    global _next
    with _cond:
        while True:
            if _next is None:
                _cond.wait()
                continue
            delay = (_next - datetime.utcnow()).total_seconds()
            if delay <= 0:
                break
            _cond.wait(timeout=delay)
        # Cleared before the pass, so anything scheduled during it is kept by
        # wake_at rather than overwritten.
        _next = None


def _pass() -> None:
    from . import digest, outbox

    try:
        digest.flush_once()
    except Exception:
        # Nothing in here may kill the thread: a digest that fails once must
        # not stop every later one.
        log.warning("Digest flush failed", exc_info=True)
    try:
        outbox.retry_due()
    except Exception:
        log.warning("Email retry sweep failed", exc_info=True)


def _loop() -> None:
    try:
        _refresh(prune=True)
    except Exception:
        log.warning("Could not read queued email at startup", exc_info=True)
    while True:
        _sleep_until_due()
        _pass()
        try:
            _refresh()
        except Exception:
            log.warning("Could not read queued email after a pass", exc_info=True)


def start() -> None:
    """Begin, once per process.

    A daemon thread so it can never hold the server open on shutdown. Guarded
    because a reloader can import and start the app more than once, and two
    schedulers in one process would be two chances to race for the same rows.
    """
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, name=THREAD_NAME, daemon=True).start()
