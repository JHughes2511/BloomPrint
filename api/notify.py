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

from sqlalchemy.exc import IntegrityError

from . import models
from .database import SessionLocal
from .emails import (ACCOUNT_EVENTS, render, render_html, render_notification,
                     render_notification_html)
from .mailer import contact_email, mail_from, try_send

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
            try:
                db.commit()
                db.refresh(pref)
            except IntegrityError:
                # Two sends to an account that has never been emailed race to
                # create this row, and the loser used to raise into _deliver's
                # catch-all, which dropped the message. Not hypothetical: a
                # changed address emails the old and the new one at once, and
                # the pool runs four at a time. The row the winner wrote is the
                # row we wanted, so read it back.
                db.rollback()
                pref = (
                    db.query(models.EmailPreference)
                    .filter_by(audience=audience, user_id=user_id)
                    .one()
                )
        return pref.token, bool(pref.opted_out)
    finally:
        db.close()


def _deliver(audience: str, user_id: int, event: str, to: str,
             lang: str | None, params: dict, link: str | None,
             decide: str | None = None) -> None:
    """Render and send. Runs on the pool; must never raise."""
    try:
        token, opted_out = _preference(audience, user_id)
        # Account mail ignores the preference: it is the direct consequence of
        # something the recipient just did, and there is nothing to opt out of.
        if opted_out and event not in ACCOUNT_EVENTS:
            return
        subject, body = render(event, lang, params, token=token, link=link,
                               decide=decide)
        # Both halves, always. The text is the message; the HTML is how it
        # looks. A client that cannot show one shows the other.
        try:
            html = render_html(event, lang, params, token=token, link=link,
                               decide=decide)
        except Exception:
            # A layout that fails must not cost someone their notification.
            log.warning("Could not lay out %s; sending as text", event, exc_info=True)
            html = None
        # Sent FROM the noreply mailbox, but a reply goes somewhere a person
        # reads. Pressing Reply is what people do instead of reading a footer,
        # and without this it was the one gesture guaranteed to fail.
        ok, reason = try_send(to, subject, body, html, from_addr=mail_from(),
                              reply_to=contact_email())
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
               link: str | None = None, decide: str | None = None) -> None:
    """Queue one event for one person. Returns immediately.

    `decide` is a token from api/decisions.py, for the messages that ask a
    question: it puts both answers in the mail as buttons.
    """
    if not to:
        return
    _pool.submit(_deliver, audience, user_id, event, to, lang,
                 dict(params or {}), link, decide)


def coach_event(coach: "models.Coach | None", event: str,
                params: dict | None = None, *, link: str | None = None,
                decide: str | None = None) -> None:
    """send_event for a coach, reading address and language off the row.

    Values are copied out here, on the caller's thread, because the row belongs
    to a session that may be closed by the time the pool gets to it.
    """
    if coach is None:
        return
    p = dict(params or {})
    p.setdefault("name", coach.name)
    send_event(COACH, coach.id, event, to=coach.email,
               lang=coach.preferred_language, params=p, link=link,
               decide=decide)


def player_event(user: "models.PlayerUser | None", event: str,
                 params: dict | None = None, *, link: str | None = None,
                 decide: str | None = None) -> None:
    """send_event for a player account, in the player's own language."""
    if user is None:
        return
    p = dict(params or {})
    p.setdefault("name", user.name)
    send_event(PLAYER, user.id, event, to=user.email,
               lang=getattr(user, "preferred_language", None),
               params=p, link=link, decide=decide)


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


# ── The other half: notifications ─────────────────────────────────────────────
#
# Everything above sends copy written for the inbox. Most of what happens in
# the app is not that: it is one of forty-odd events that already writes an
# in-app notification, and the email for it should say the same thing rather
# than a second version of it. The words come from the app's own packs by way
# of api/notif_copy.py, so there is one place to edit and the two channels
# cannot come to disagree.

def _deliver_notification(audience: str, user_id: int, key: str, to: str,
                          lang: str | None, params: dict, link: str | None,
                          decide: str | None = None,
                          decide_label: str | None = None) -> None:
    """Render one notification as mail and send it. Never raises."""
    try:
        token, opted_out = _preference(audience, user_id)
        # Every notification is opt-out-able by definition: account mail is
        # written as an event, not as a notification row.
        if opted_out:
            return
        rendered = render_notification(key, lang, params, token=token, link=link,
                                       decide=decide, decide_label=decide_label)
        if rendered is None:
            # No copy for the key, or a param the caller did not pass. Both
            # mean the message would read as a bug; the in-app row still shows.
            log.warning("No email copy for notification %s", key)
            return
        subject, body = rendered
        try:
            html = render_notification_html(key, lang, params, token=token,
                                            link=link, decide=decide,
                                            decide_label=decide_label)
        except Exception:
            log.warning("Could not lay out %s; sending as text", key, exc_info=True)
            html = None
        ok, reason = try_send(to, subject, body, html, from_addr=mail_from(),
                              reply_to=contact_email())
        if not ok:
            log.warning("Notification email %s to %s not sent: %s", key, to, reason)
    except Exception:
        log.warning("Could not email notification %s to %s #%s", key, audience,
                    user_id, exc_info=True)


def notification(audience: str, user_id: int, key: str, *, to: str | None,
                 lang: str | None, params: dict | None = None,
                 link: str | None = None, decide: str | None = None,
                 decide_label: str | None = None) -> None:
    """Send the email for one in-app notification, or queue it for the digest.

    Returns immediately either way. Which of the two happens is decided here
    rather than at the call sites, so a caller writes the same line whether the
    event is chatty or not, and the policy is one list to read.
    """
    if not to:
        return
    if _digested(key):
        from . import digest
        digest.queue(audience, user_id, key, params, link)
        return
    _pool.submit(_deliver_notification, audience, user_id, key, to, lang,
                 dict(params or {}), link, decide, decide_label)


def coach_notification(coach: "models.Coach | None", key: str,
                       params: dict | None = None, *, link: str | None = None,
                       decide: str | None = None,
                       decide_label: str | None = None) -> None:
    """The coach's copy of a notification, in the coach's language.

    Address and language are read here, on the caller's thread, because the row
    belongs to a session that may be closed by the time the pool reaches it.
    """
    if coach is None:
        return
    notification(COACH, coach.id, key, to=coach.email,
                 lang=coach.preferred_language, params=params, link=link,
                 decide=decide, decide_label=decide_label)


def player_notification(user: "models.PlayerUser | None", key: str,
                        params: dict | None = None, *, link: str | None = None,
                        decide: str | None = None) -> None:
    """The player's copy of a notification, in the player's language."""
    if user is None:
        return
    notification(PLAYER, user.id, key, to=user.email,
                 lang=getattr(user, "preferred_language", None),
                 params=params, link=link, decide=decide)


# Events that go into the hourly digest instead of leaving one at a time. See
# api/digest.py for why these and not others.
DIGEST_KEYS = {
    "playerCommentedReport",
    "playerCommentedTraining",
    "coachCommentedTraining",
    "coachRepliedComment",
    "coachRepliedTraining",
    # A back-and-forth between two coaches is as fast as a comment thread, and
    # one email per message is one email per sentence.
    "staffMessage",
    "staffMessageGroup",
}


def _digested(key: str) -> bool:
    return (key or "").split(".")[-1] in DIGEST_KEYS
