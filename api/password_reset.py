"""Getting back into an account you cannot sign in to.

Written once and used by both the coach and the player routes. The security
properties of a reset are the part that must not differ between two audiences,
and two copies of this drift the first time either is touched.

WHAT A RESET TOKEN IS

A temporary password. Anyone holding one can take the account, so it is treated
like one:

  - Only its hash is stored. A leaked database hands over no working links.
  - It works once. The row is marked used rather than deleted, so a replay is
    recognised rather than merely failing to match.
  - It expires. Twenty-four hours, so someone who reads their mail the next
    morning is not locked out by the clock.
  - Asking for one invalidates any earlier one for that account, because two
    live links are two chances for the wrong person to hold one.

WHAT THE REQUEST ENDPOINT MUST NOT SAY

Whether the address has an account. A form that answers that question is a way
to test which addresses are registered, one at a time, for anyone who wants a
list. The response is the same either way and the work happens or does not
behind it.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from . import models

# Long enough to be worth reading a whole inbox for, short enough that a link
# forwarded or left in a shared mailbox is usually dead by the time it is found.
TOKEN_LIFETIME = timedelta(hours=24)

COACH = "coach"
PLAYER = "player"


def _hash(token: str) -> str:
    """SHA-256, not bcrypt.

    bcrypt is deliberately slow because a password is short and guessable. This
    token is 43 characters of urlsafe randomness, so there is nothing to slow an
    attacker down FOR: guessing it is infeasible regardless. What matters is
    that the stored form cannot be turned back into a working link, and a plain
    digest does that at a speed that lets the lookup stay an indexed one.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def issue(db: Session, audience: str, user_id: int) -> str:
    """Mint a reset token, retiring any the account already has.

    Returns the token itself. It is never stored, so this is the only moment it
    exists in a readable form; a caller that loses it cannot look it up.
    """
    now = datetime.utcnow()
    live = (
        db.query(models.PasswordReset)
        .filter(models.PasswordReset.audience == audience,
                models.PasswordReset.user_id == user_id,
                models.PasswordReset.used_at.is_(None),
                models.PasswordReset.expires_at > now)
        .all()
    )
    for row in live:
        # Retired by marking used rather than deleted: the row is the record
        # that a link was issued and then superseded.
        row.used_at = now

    token = secrets.token_urlsafe(32)
    db.add(models.PasswordReset(
        audience=audience, user_id=user_id, token_hash=_hash(token),
        expires_at=now + TOKEN_LIFETIME,
    ))
    db.commit()
    return token


def redeem(db: Session, token: str, audience: str) -> models.PasswordReset | None:
    """The row this token belongs to, if it is still good, marked used.

    Marking used here rather than in the caller means a token cannot be spent
    twice even if the caller then fails: the worst case is a reset that has to
    be asked for again, and the alternative is a link that keeps working.

    The audience is checked BEFORE that mark, not after. Checking it afterwards
    meant posting a player's token to the coach endpoint consumed it and then
    refused it, so the player's own link was dead before they clicked it: a way
    to deny somebody a reset with one request. A token for the wrong audience
    is now simply not recognised.
    """
    if not token:
        return None
    row = (
        db.query(models.PasswordReset)
        .filter_by(token_hash=_hash(token))
        .one_or_none()
    )
    if row is None or row.audience != audience or not row.is_live:
        return None
    row.used_at = datetime.utcnow()
    db.commit()
    return row


def account_for(db: Session, row: models.PasswordReset):
    """The coach or player a reset row belongs to."""
    model = models.Coach if row.audience == COACH else models.PlayerUser
    return db.get(model, row.user_id)


def end_all_sessions(account) -> None:
    """Make every token issued before now stop working.

    The point of a reset is often that somebody else is in the account, and a
    new password does nothing about a session they are already holding. Sessions
    are stateless JWTs with no server-side record to revoke, so the epoch
    travelling inside each token is what ends them.
    """
    account.session_epoch = int(account.session_epoch or 0) + 1
