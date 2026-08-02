"""Email as a channel on the notification system, not a parallel one.

Events already write a CoachNotification or PlayerNotification with an i18n key
and params. This turns one of those into an email for the same person, using
the same params, so the two can never describe the event differently.

Two things this deliberately does not do:

It never touches the caller's session. Callers write their notification and
commit afterwards, so reading or creating a preference row on their session
would commit their half-built transaction for them. Preferences get their own
short session, opened and closed here.

It never blocks the request. A send is a network round trip to a third party;
a coach approving a join request should not wait on it. Sends run on a small
pool, and a failure is logged rather than raised — the event already happened,
and mail must not be able to undo it.
"""
from __future__ import annotations

import logging
import secrets
from concurrent.futures import ThreadPoolExecutor

from . import models
from .database import SessionLocal
from .emails import ACCOUNT_EVENTS, render
from .mailer import mail_from, try_send

log = logging.getLogger(__name__)

COACH = "coach"
PLAYER = "player"

# Small on purpose. Mail is not urgent and the volume is low; what matters is
# that a slow provider cannot pile up threads behind a burst of shares.
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="mail")


def _preference(audience: str, user_id: int) -> tuple[str, bool]:
    """(token, opted_out) for one account, created opted-in on first sight.

    Absence means opted in, so a row is only written when someone is first
    emailed — every account that predates this table behaves correctly with no
    backfill. Runs on its own session; see the module docstring.
    """
    db = SessionLocal()
    try:
        pref = (
            db.query(models.EmailPreference)
            .filter_by(audience=audience, user_id=user_id)
            .one_or_none()
        )
        if pref is None:
            pref = models.EmailPreference(
                audience=audience, user_id=user_id, opted_out=False,
                token=secrets.token_urlsafe(32),
            )
            db.add(pref)
            db.commit()
            db.refresh(pref)
        return pref.token, bool(pref.opted_out)
    finally:
        db.close()


def _deliver(audience: str, user_id: int, event: str, to: str,
             lang: str | None, params: dict, link: str | None) -> None:
    """Render and send. Runs on the pool; must never raise."""
    try:
        token, opted_out = _preference(audience, user_id)
        # Account mail ignores the preference: it is the direct consequence of
        # something the recipient just did, and there is nothing to opt out of.
        if opted_out and event not in ACCOUNT_EVENTS:
            return
        subject, body = render(event, lang, params, token=token, link=link)
        ok, reason = try_send(to, subject, body, from_addr=mail_from())
        if not ok:
            # Said out loud rather than swallowed. Mail failing must not break
            # the event, but a silent return means "no mail arrived" and "no
            # mail was configured" look identical from the outside, and that is
            # exactly the question to answer when someone reports missing mail.
            log.warning("Email %s to %s not sent: %s", event, to, reason)
    except Exception:
        log.warning("Could not email %s to %s #%s", event, audience, user_id,
                    exc_info=True)


def send_event(audience: str, user_id: int, event: str, *, to: str | None,
               lang: str | None, params: dict | None = None,
               link: str | None = None) -> None:
    """Queue one event for one person. Returns immediately."""
    if not to:
        return
    _pool.submit(_deliver, audience, user_id, event, to, lang,
                 dict(params or {}), link)


def coach_event(coach: "models.Coach | None", event: str,
                params: dict | None = None, *, link: str | None = None) -> None:
    """send_event for a coach, reading address and language off the row.

    Values are copied out here, on the caller's thread, because the row belongs
    to a session that may be closed by the time the pool gets to it.
    """
    if coach is None:
        return
    p = dict(params or {})
    p.setdefault("name", coach.name)
    send_event(COACH, coach.id, event, to=coach.email,
               lang=coach.preferred_language, params=p, link=link)


def player_event(user: "models.PlayerUser | None", event: str,
                 params: dict | None = None, *, link: str | None = None) -> None:
    """send_event for a player account, in the player's own language."""
    if user is None:
        return
    p = dict(params or {})
    p.setdefault("name", user.name)
    send_event(PLAYER, user.id, event, to=user.email,
               lang=getattr(user, "preferred_language", None),
               params=p, link=link)


def is_opted_out(audience: str, user_id: int) -> bool:
    """Whether this account has activity email switched off."""
    return _preference(audience, user_id)[1]


def set_opted_out(audience: str, user_id: int, value: bool) -> bool:
    """Switch activity email on or off. Returns the stored value.

    Creates the row if this account has never been emailed, so the setting can
    be turned off before the first message rather than only after one arrives.
    """
    _preference(audience, user_id)  # ensure the row and token exist
    db = SessionLocal()
    try:
        pref = (
            db.query(models.EmailPreference)
            .filter_by(audience=audience, user_id=user_id)
            .one()
        )
        pref.opted_out = bool(value)
        db.commit()
        return bool(pref.opted_out)
    finally:
        db.close()
