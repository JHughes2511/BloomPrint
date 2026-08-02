"""Email as a channel on the notification system, not a parallel one.

Events already write a CoachNotification or PlayerNotification with an i18n key
and params. This turns one of those into an email for the same person, using
the same params, so the two can never describe the event differently.

Sending is best-effort and never raises: an event that happened must not fail
to happen because mail did.
"""
from __future__ import annotations

import logging
import secrets

from sqlalchemy.orm import Session

from . import models
from .emails import ACCOUNT_EVENTS, render
from .mailer import mail_from, send_email

log = logging.getLogger(__name__)

COACH = "coach"
PLAYER = "player"


def _preference(db: Session, audience: str, user_id: int) -> models.EmailPreference:
    """This account's row, created opted-in on first sight.

    Absence means opted in, so the row is only written when someone is first
    emailed — every account that predates this table behaves correctly without
    a backfill.
    """
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
    return pref


def wants(db: Session, audience: str, user_id: int, event: str) -> bool:
    """Whether this event may be emailed to this account.

    Account mail ignores the preference: it is the direct consequence of
    something the recipient just did, and there is nothing to opt out of.
    """
    if event in ACCOUNT_EVENTS:
        return True
    return not _preference(db, audience, user_id).opted_out


def send_event(db: Session, audience: str, user_id: int, event: str, *,
               to: str | None, lang: str | None, params: dict | None = None,
               link: str | None = None) -> bool:
    """Email one event to one person. Returns whether it went out.

    Swallows everything: this is called from the same request that performed the
    action, and a mail failure must not roll it back.
    """
    if not to:
        return False
    try:
        if not wants(db, audience, user_id, event):
            return False
        pref = _preference(db, audience, user_id)
        subject, body = render(event, lang, params, token=pref.token, link=link)
        return send_email(to, subject, body, from_addr=mail_from(),
                          reply_to=None)
    except Exception:
        log.warning("Could not email %s to %s #%s", event, audience, user_id,
                    exc_info=True)
        return False


def coach_event(db: Session, coach: "models.Coach | None", event: str,
                params: dict | None = None, *, link: str | None = None) -> bool:
    """send_event for a coach, reading their address and language off the row."""
    if coach is None:
        return False
    p = dict(params or {})
    p.setdefault("name", coach.name)
    return send_event(db, COACH, coach.id, event, to=coach.email,
                      lang=coach.preferred_language, params=p, link=link)


def player_event(db: Session, user: "models.PlayerUser | None", event: str,
                 params: dict | None = None, *, link: str | None = None) -> bool:
    """send_event for a player account.

    PlayerUser has no language column, so these render in English until it does
    — better than not sending, and the fallback is already the documented
    behaviour for an unknown language.
    """
    if user is None:
        return False
    p = dict(params or {})
    p.setdefault("name", user.name)
    return send_event(db, PLAYER, user.id, event, to=user.email,
                      lang=getattr(user, "preferred_language", None),
                      params=p, link=link)
