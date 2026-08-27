"""Closing an account.

WHY NOTHING IS ACTUALLY DELETED

Fifty foreign keys point at `coaches` and ten at `player_users`, and nearly all
of them are NOT NULL. Worse, many belong to somebody else: a report another
coach shared TO this one, a comment this coach left on a player's programme, a
team three assistants work on. A DELETE would either fail on the constraints or
take other people's work down with it, and neither is an acceptable answer to
"close my account".

So the row stays and stops being reachable. The account cannot be signed in to,
cannot be found, and cannot be sent anything; to everyone else in the app the
person is gone. What survives is the shape of the history other people still
depend on, and — until and unless erasure is asked for — the account itself.

CLOSED, NOT ERASED

Asking closes the account immediately: signed out of every device, sign-in
refused, and nobody in the app can reach them any more. Nothing personal is
destroyed, and nothing is destroyed on a timer either. Somebody who steps away
for a season and comes back gets their account, not a condolence page.

There are two ways back, on purpose:

  - The link in the confirmation email, good for a week. That is the one for
    somebody who pressed the button by mistake and notices the same evening,
    and it is short-lived because a link in an inbox is a bearer credential.
  - Their own password, good forever. Signing in to a closed account with the
    right credentials offers to reopen it. Nothing is revealed to anyone who
    does not already have the password: a wrong one answers exactly as it
    always did.

ERASURE IS A SEPARATE REQUEST

purge() below overwrites everything personal and cannot be undone by anyone. It
runs only when somebody explicitly asks to be erased rather than merely to
leave. No timer calls it, which is the whole point of the choice above.

WHAT HAPPENS TO A TEAM THEY OWNED

Nothing, immediately. The team keeps running and its staff keep their access.
Once the owner is closed, the team counts as orphaned, which is the existing
path any staff member already has for claiming a team whose owner left. That
check used to ask whether the owner's ROW was gone; since the row now stays, it
asks this module instead.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from . import models

log = logging.getLogger(__name__)

# How long the emailed undo link stays good. Not how long the account stays
# recoverable — that is forever, through the password. This is only the life of
# a bearer token sitting in an inbox.
UNDO_WINDOW = timedelta(days=7)

COACH = "coach"
PLAYER = "player"

# The address a closed account is given. .invalid is reserved by RFC 2606 and
# can never be a real domain, so a scrubbed row can never collide with a live
# address or accidentally be mailed. Unique per account because both tables
# hold email unique and NOT NULL — it cannot simply be blanked.
PURGED_DOMAIN = "bloomprint.invalid"


def _hash(token: str) -> str:
    """See password_reset._hash: a digest, not bcrypt, for the same reason."""
    return hashlib.sha256(token.encode()).hexdigest()


def _model(audience: str):
    return models.Coach if audience == COACH else models.PlayerUser


def is_closed(account) -> bool:
    """Whether this account has been closed, whether or not it is scrubbed yet."""
    return bool(account is not None and getattr(account, "deleted_at", None))


def request(db: Session, audience: str, account) -> str:
    """Close the account now, and return the token that can undo it.

    The token is never stored, so this is the only moment it exists in a
    readable form; it goes into the confirmation email and nowhere else.
    """
    now = datetime.utcnow()
    account.deleted_at = now
    # Every device, immediately. A closed account that is still signed in
    # somewhere is not closed.
    account.session_epoch = int(getattr(account, "session_epoch", 0) or 0) + 1

    # An earlier request that was never undone is superseded rather than left
    # live: two undo links for one account is one more than is needed.
    for row in (db.query(models.AccountDeletion)
                .filter_by(audience=audience, user_id=account.id)
                .filter(models.AccountDeletion.undone_at.is_(None),
                        models.AccountDeletion.purged_at.is_(None))
                .all()):
        row.undone_at = now

    token = secrets.token_urlsafe(32)
    db.add(models.AccountDeletion(audience=audience, user_id=account.id,
                                  token_hash=_hash(token), requested_at=now))
    db.commit()
    return token


def pending(db: Session, token: str) -> models.AccountDeletion | None:
    """The request this token belongs to, if it can still be undone."""
    if not token:
        return None
    row = (db.query(models.AccountDeletion)
           .filter_by(token_hash=_hash(token))
           .one_or_none())
    if row is None or row.undone_at or row.purged_at:
        return None
    if datetime.utcnow() - row.requested_at > UNDO_WINDOW:
        return None
    return row


def account_for(db: Session, row: models.AccountDeletion):
    return db.get(_model(row.audience), row.user_id)


def undo(db: Session, row: models.AccountDeletion) -> bool:
    """Bring the account back. Only possible before it has been scrubbed."""
    account = account_for(db, row)
    if account is None or row.purged_at:
        return False
    row.undone_at = datetime.utcnow()
    account.deleted_at = None
    # The epoch is NOT rolled back. Tokens issued before the request stay dead,
    # which is right: if the account was closed because somebody else had got
    # into it, undoing must not hand their session back.
    db.commit()
    return True


def _scrub_coach(account, marker: str) -> None:
    account.name = "Deleted account"
    account.email = marker
    # Unusable rather than empty: an empty hash is a hash that something might
    # one day compare successfully against.
    account.password_hash = secrets.token_urlsafe(48)
    account.google_sub = None
    account.job_title = None
    account.country = None
    account.city = None
    account.conference = None
    # The program name and the philosophy are the coach's own writing, not a
    # team's property, and nothing another coach sees depends on them.
    account.program_name = None
    account.system_profile = None
    account.philosophy_reference = None
    account.play_style_profile = None


def _scrub_player(account, marker: str) -> None:
    account.name = "Deleted account"
    account.email = marker
    account.password_hash = secrets.token_urlsafe(48)
    account.google_sub = None
    account.avatar = None
    account.country = None
    account.city = None
    # The roster row stays with the coach: it is their record of a player, and
    # it existed before this account linked to it. The link is what goes.
    account.player_id = None


def purge(db: Session, row: models.AccountDeletion) -> bool:
    """Overwrite everything personal. Nothing here can be undone by anyone.

    Nothing schedules this. It exists for somebody who asks to be erased rather
    than to leave, which is a different request and a rarer one.
    """
    account = account_for(db, row)
    if account is None:
        row.purged_at = datetime.utcnow()
        db.commit()
        return False
    marker = f"deleted+{row.audience}{account.id}@{PURGED_DOMAIN}"
    if row.audience == COACH:
        _scrub_coach(account, marker)
    else:
        _scrub_player(account, marker)
        # Links to coaches' rosters go, so a closed player stops appearing on
        # anyone's team.
        (db.query(models.PlayerUserLink)
           .filter_by(player_user_id=account.id).delete(synchronize_session=False))
    # Nobody is emailed a closed account again, and the opt-out row is the only
    # other place their address could be reached from.
    (db.query(models.EmailPreference)
       .filter_by(audience=row.audience, user_id=account.id)
       .delete(synchronize_session=False))
    (db.query(models.PendingNotification)
       .filter_by(audience=row.audience, user_id=account.id)
       .delete(synchronize_session=False))
    row.purged_at = datetime.utcnow()
    db.commit()
    return True


def latest(db: Session, audience: str, user_id: int) -> models.AccountDeletion | None:
    """The live closure record for an account, if it has one."""
    return (db.query(models.AccountDeletion)
            .filter_by(audience=audience, user_id=user_id)
            .filter(models.AccountDeletion.undone_at.is_(None),
                    models.AccountDeletion.purged_at.is_(None))
            .order_by(models.AccountDeletion.requested_at.desc())
            .first())


def reopen(db: Session, audience: str, account) -> bool:
    """Bring a closed account back, on the strength of its own password.

    The permanent way in. Its counterpart, undo(), is the emailed link and dies
    with the token; this one is available for as long as they remember how to
    sign in, which is what "just in case they want to come back" has to mean if
    it is to mean anything a season later.
    """
    if not is_closed(account):
        return False
    row = latest(db, audience, account.id)
    if row is not None:
        row.undone_at = datetime.utcnow()
    account.deleted_at = None
    # The epoch is not rolled back; see undo() for why.
    db.commit()
    return True
