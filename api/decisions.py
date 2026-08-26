"""Answering a request from the email, without opening the app.

Five things in BloomPrint wait on somebody saying yes or no: a player consenting
to a report about them going to another player, an owner answering a join
request, a coach answering an invite, an owner answering a proposed roster
addition, and a coach answering a player asking to be linked to a roster spot.
Each of those already emails the person it is waiting on. Making them open the
app, find the screen and press the button is three steps to say one word, and
the request sits there in the meantime.

WHAT A DECISION LINK IS

A single-use permission to answer one request as one person. Following it
carries the decision out; there is no confirmation step, because the point is
not having to go anywhere. That makes the link itself the credential, and it is
treated like one:

  - Only its hash is stored, so a leaked database hands over no working links.
  - It works once, and the row records that it was spent.
  - It dies after seven days.
  - It is minted per person and per request. Several coaches hear about one
    link request; a link that worked for whoever it was forwarded to would let
    a stranger settle another coach's roster.

The risk this leaves, worth naming because it is invisible from the outside:
some mail systems fetch links before a person reads the message, and a fetch is
a decision. The four properties above bound what one such fetch can reach, and
the app's own screens stay the authority for anyone who would rather look
first.

WHY IT REUSES THE ROUTES

The decision itself is not reimplemented here. Each entry below calls the same
function the app's own button calls, with the same arguments, so a change to
what approving means happens in one place. What this module owns is only:
proving who is answering, and refusing a link that is old, spent, or points at
a request that has already been settled.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from . import models

# Long enough for someone who reads their mail once a week. Beyond that the
# request is stale enough that seeing it in the app is no hardship, and a
# month-old link sitting in an inbox is a month of it being forwardable.
TOKEN_LIFETIME = timedelta(days=7)

COACH = "coach"
PLAYER = "player"


def _hash(token: str) -> str:
    """See password_reset._hash: a digest, not bcrypt, for the same reason."""
    return hashlib.sha256(token.encode()).hexdigest()


# ── What each kind of request is, and how it is answered ─────────────────────
#
# `pending` answers "is this still waiting?" so a link to a settled request can
# say so rather than doing nothing quietly. `approve`/`reject` are the app's own
# handlers, called directly: they take db and the actor as ordinary arguments,
# and FastAPI's Depends defaults are only defaults.

def _share_pending(db: Session, row_id: int, user_id: int) -> bool:
    a = db.get(models.ShareApproval, row_id)
    return bool(a and a.subject_player_user_id == user_id and a.status == "pending")


def _join_pending(db: Session, row_id: int, user_id: int) -> bool:
    req = db.get(models.TeamInvite, row_id)
    if not req or req.kind != "request" or req.status != "pending":
        return False
    team = db.get(models.Team, req.team_id)
    return bool(team and team.coach_id == user_id)


def _invite_pending(db: Session, row_id: int, user_id: int) -> bool:
    inv = db.get(models.TeamInvite, row_id)
    return bool(inv and inv.kind == "invite" and inv.status == "pending"
                and inv.invited_coach_id == user_id)


def _link_pending(db: Session, row_id: int, user_id: int) -> bool:
    """A link request is answerable by any coach it was sent to.

    Several coaches are notified about one request — the roster owner and the
    team's staff — so entitlement is "this request reached you", not "this
    request is yours". Whoever answers first settles it, which is what happens
    in the app too.
    """
    lr = db.get(models.LinkRequest, row_id)
    if not lr or lr.status != "pending":
        return False
    player = db.get(models.Player, lr.player_id)
    if not player:
        return False
    if player.coach_id == user_id:
        return True
    if player.team_id:
        team = db.get(models.Team, player.team_id)
        if team and team.coach_id == user_id:
            return True
        return bool(db.query(models.TeamStaff)
                    .filter_by(team_id=player.team_id, coach_id=user_id).first())
    return False


def _proposal_pending(db: Session, row_id: int, user_id: int) -> bool:
    row = db.get(models.RosterProposal, row_id)
    if not row or row.status != "pending":
        return False
    team = db.get(models.Team, row.team_id)
    return bool(team and team.coach_id == user_id)


def _kinds() -> dict:
    """Imported lazily: the route modules import this one for link building."""
    from .routes import player_routes, team_staff

    return {
        "share_approval": {
            "audience": PLAYER,
            "pending": _share_pending,
            "approve": lambda db, user, rid: player_routes.approve_share(
                approval_id=rid, db=db, pu=user),
            "reject": lambda db, user, rid: player_routes.reject_share(
                approval_id=rid, db=db, pu=user),
        },
        "team_join_request": {
            "audience": COACH,
            "pending": _join_pending,
            "approve": lambda db, user, rid: team_staff.approve_join_request(
                request_id=rid, db=db, coach=user),
            "reject": lambda db, user, rid: team_staff.reject_join_request(
                request_id=rid, db=db, coach=user),
        },
        "team_invite": {
            "audience": COACH,
            "pending": _invite_pending,
            "approve": lambda db, user, rid: team_staff.approve_invite(
                invite_id=rid, db=db, coach=user),
            "reject": lambda db, user, rid: team_staff.reject_invite(
                invite_id=rid, db=db, coach=user),
        },
        "player_link_request": {
            "audience": COACH,
            "pending": _link_pending,
            "approve": lambda db, user, rid: player_routes.approve_link(
                request_id=rid, db=db, coach=user),
            "reject": lambda db, user, rid: player_routes.reject_link(
                request_id=rid, db=db, coach=user),
        },
        "roster_proposal": {
            "audience": COACH,
            "pending": _proposal_pending,
            "approve": lambda db, user, rid: team_staff.approve_roster_proposal(
                proposal_id=rid, db=db, coach=user),
            "reject": lambda db, user, rid: team_staff.reject_roster_proposal(
                proposal_id=rid, db=db, coach=user),
        },
    }


KINDS = ("share_approval", "team_join_request", "team_invite",
         "roster_proposal", "player_link_request")


def issue(db: Session, kind: str, target_id: int, audience: str,
          user_id: int) -> str | None:
    """Mint a link for one person to answer one request.

    Returns the token, which is never stored, so this is the only moment it
    exists in a readable form. None for a kind that is not answerable this way,
    so a caller that passes something unexpected sends a plain email rather
    than one with a broken button in it.
    """
    if kind not in KINDS:
        return None
    now = datetime.utcnow()
    # An earlier link for the same request is retired: two live ways to answer
    # one thing is one more than is needed.
    for row in (db.query(models.DecisionToken)
                .filter_by(kind=kind, target_id=target_id, audience=audience,
                           user_id=user_id)
                .filter(models.DecisionToken.used_at.is_(None))
                .all()):
        row.used_at = now

    token = secrets.token_urlsafe(32)
    db.add(models.DecisionToken(
        token_hash=_hash(token), kind=kind, target_id=target_id,
        audience=audience, user_id=user_id, expires_at=now + TOKEN_LIFETIME,
    ))
    db.commit()
    return token


def lookup(db: Session, token: str) -> models.DecisionToken | None:
    """The row this token belongs to, if it is still good. Nothing is spent."""
    if not token:
        return None
    row = (db.query(models.DecisionToken)
           .filter_by(token_hash=_hash(token))
           .one_or_none())
    if row is None or not row.is_live:
        return None
    return row


def account_for(db: Session, row: models.DecisionToken):
    model = models.Coach if row.audience == COACH else models.PlayerUser
    return db.get(model, row.user_id)


def still_pending(db: Session, row: models.DecisionToken) -> bool:
    """Whether the request behind this link is still waiting on an answer."""
    spec = _kinds().get(row.kind)
    if spec is None:
        return False
    return bool(spec["pending"](db, row.target_id, row.user_id))


def decide(db: Session, row: models.DecisionToken, choice: str) -> str:
    """Carry out the decision and spend the link.

    Returns "approved", "rejected", "gone" (the request is no longer waiting)
    or "failed". The token is spent on any real attempt, so a page reloaded or
    a link followed twice cannot answer twice.
    """
    spec = _kinds().get(row.kind)
    if spec is None:
        return "failed"
    user = account_for(db, row)
    if user is None:
        return "failed"
    if not spec["pending"](db, row.target_id, row.user_id):
        # Answered in the app, withdrawn, or already decided through this link.
        row.used_at = datetime.utcnow()
        db.commit()
        return "gone"

    action = spec["approve"] if choice == "approve" else spec["reject"]
    try:
        action(db, user, row.target_id)
    except Exception:
        db.rollback()
        return "failed"
    row.used_at = datetime.utcnow()
    db.commit()
    return "approved" if choice == "approve" else "rejected"
