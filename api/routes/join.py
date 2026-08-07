"""Signing up straight onto a team, from a link or a QR code.

A coach holds up a QR at a tryout, or texts a link to a parent. Whoever opens
it signs up and lands on that team — as a player on the roster, or as staff —
without the coach typing anyone's email or the newcomer knowing a code.

WHAT THE PUBLIC CAN SEE

Almost nothing: the team's name and who invited them, which they already know
because they were handed the link. The roster is only readable AFTER signing in
— otherwise a forwarded link would be a way to read a coach's roster without an
account. Every other route here needs a real session.

REVOKING

A link belongs to whoever made it. Revoking yours refuses that code and no
other; an assistant's link for the same team keeps working, and is theirs to
revoke. Revoking is about the door — people already inside stay until they are
removed from the team.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models, ratelimit
from .player_auth import get_current_player_user

router = APIRouter(prefix="/join", tags=["join"])


def _live_link(db: Session, code: str) -> models.TeamJoinLink:
    link = db.query(models.TeamJoinLink).filter_by(code=(code or "").strip()).first()
    if not link:
        raise HTTPException(status_code=404, detail="This invite link is not valid.")
    if link.revoked_at is not None:
        raise HTTPException(status_code=410, detail="This invite link has been revoked.")
    return link


@router.get("/{code}")
def peek(code: str, request: Request, db: Session = Depends(get_db)):
    """Public: just enough to show "X invited you to Y" before signing up."""
    ratelimit.check(request, "join-peek")
    link = _live_link(db, code)
    # Enough to fill in a signup form for them, and nothing that is not already
    # on the invitation itself: the team, who sent it, and the level that team
    # plays at. No roster, no members, no contact details.
    return {
        "team_id": link.team_id,
        "team_name": link.team.name if link.team else "",
        "invited_by": link.creator.name if link.creator else "",
        "program": (link.creator.program_name if link.creator else "") or (link.team.name if link.team else ""),
        "competition_level": (link.team.competition_level if link.team else None)
                             or (link.creator.competition_level if link.creator else None),
    }


@router.post("/{code}/staff")
def join_as_staff(
    code: str,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """A coach, scout or trainer joins the team the link points at."""
    link = _live_link(db, code)
    team = link.team
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if team.coach_id == coach.id:
        return {"ok": True, "team_name": team.name, "already": True}
    existing = db.query(models.TeamStaff).filter_by(team_id=team.id, coach_id=coach.id).first()
    if not existing:
        db.add(models.TeamStaff(team_id=team.id, coach_id=coach.id))
        db.add(models.TeamJoinEvent(link_id=link.id, coach_id=coach.id, kind="staff",
                                    display_name=coach.name))
        # The coach who shared the link should know who used it without going
        # looking — auto-join means nobody approved this.
        db.add(models.PlayerNotification(
            coach_id=link.created_by,
            type="team_joined",
            title="Someone joined your team",
            body=f"{coach.name} joined {team.name} through your invite link.",
            i18n_key="notifs.joinedViaLink",
            i18n_params={"name": coach.name, "team": team.name},
            ref_id=team.id,
        ))
        db.commit()
    return {"ok": True, "team_name": team.name, "already": bool(existing)}


@router.get("/{code}/roster")
def unclaimed_roster(
    code: str,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    """Players on that team nobody has claimed yet — "which one are you?".

    Needs a signed-in player account: the list is a roster, and a link that
    could be forwarded must not be a way to read one.
    """
    link = _live_link(db, code)
    claimed = {
        l.player_id for l in db.query(models.PlayerUserLink)
        .filter(models.PlayerUserLink.player_id.isnot(None)).all()
    }
    rows = db.query(models.Player).filter_by(team_id=link.team_id).all()
    return {
        "team_name": link.team.name if link.team else "",
        "players": [
            {"id": p.id, "name": p.name, "position": p.position, "jersey_number": p.jersey_number}
            for p in rows if p.id not in claimed
        ],
    }


class ClaimIn(BaseModel):
    # One of: an existing unclaimed roster entry, or a name to create one under.
    player_id: int | None = None
    name: str | None = None


@router.post("/{code}/player")
def join_as_player(
    code: str,
    body: ClaimIn,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    """Claim a roster entry on that team, or create one and claim it."""
    from .player_routes import _add_player_link

    link = _live_link(db, code)
    team = link.team
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    if body.player_id:
        player = db.get(models.Player, body.player_id)
        if not player or player.team_id != team.id:
            raise HTTPException(status_code=404, detail="That player is not on this team.")
        taken = db.query(models.PlayerUserLink).filter_by(player_id=player.id).first()
        if taken and taken.player_user_id != pu.id:
            raise HTTPException(status_code=409, detail="Someone has already claimed that name.")
    else:
        name = (body.name or pu.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Enter the name to add to the roster.")
        # The roster belongs to the team's owner, which is what makes the new
        # entry show up on their roster immediately rather than nowhere.
        player = models.Player(
            name=name,
            coach_id=team.coach_id,
            team_id=team.id,
            program_name=team.name,
            competition_level=team.competition_level,
        )
        db.add(player)
        db.flush()

    _add_player_link(db, pu, player.id, team.coach_id)
    db.add(models.TeamJoinEvent(link_id=link.id, player_user_id=pu.id, player_id=player.id,
                                kind="player", display_name=player.name))
    db.add(models.PlayerNotification(
        coach_id=link.created_by,
        type="team_joined",
        title="A player joined your team",
        body=f"{player.name} joined {team.name} through your invite link.",
        i18n_key="notifs.joinedViaLink",
        i18n_params={"name": player.name, "team": team.name},
        ref_id=team.id,
    ))
    db.commit()
    return {"ok": True, "team_name": team.name, "player_id": player.id, "player_name": player.name}


# ── The coach's side: making, sharing and revoking a link ────────────────────

# Deliberately NOT under /teams: a path like /teams/join-link/... is matched by
# the existing /teams/{team_id} first, and "join-link" is not an int — so every
# request would 422 with nothing in the code looking wrong. The film catalog
# shipped with exactly that bug once already.
link_router = APIRouter(prefix="/team-invites", tags=["join"])


def _can_invite(db: Session, team_id: int, coach_id: int) -> bool:
    team = db.get(models.Team, team_id)
    if not team:
        return False
    if team.coach_id == coach_id:
        return True
    return db.query(models.TeamStaff).filter_by(team_id=team_id, coach_id=coach_id).first() is not None


def _link_out(db: Session, link: models.TeamJoinLink) -> dict:
    joins = db.query(models.TeamJoinEvent).filter_by(link_id=link.id).order_by(
        models.TeamJoinEvent.id.desc()).all()
    return {
        "id": link.id,
        "code": link.code,
        "team_id": link.team_id,
        "team_name": link.team.name if link.team else "",
        "created_at": link.created_at,
        "revoked": link.revoked_at is not None,
        "joined": [
            {"kind": j.kind, "name": j.display_name, "at": j.created_at}
            for j in joins
        ],
    }


@link_router.get("/{team_id}")
def my_join_link(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """My live link for this team, if I have made one."""
    if not _can_invite(db, team_id, coach.id):
        raise HTTPException(status_code=403, detail="Only this team's staff can invite.")
    link = (
        db.query(models.TeamJoinLink)
        .filter_by(team_id=team_id, created_by=coach.id, revoked_at=None)
        .order_by(models.TeamJoinLink.id.desc())
        .first()
    )
    return _link_out(db, link) if link else {"code": None}


@link_router.post("/{team_id}")
def create_join_link(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Make my link for this team, or hand back the one I already have."""
    if not _can_invite(db, team_id, coach.id):
        raise HTTPException(status_code=403, detail="Only this team's staff can invite.")
    existing = (
        db.query(models.TeamJoinLink)
        .filter_by(team_id=team_id, created_by=coach.id, revoked_at=None)
        .order_by(models.TeamJoinLink.id.desc())
        .first()
    )
    if existing:
        return _link_out(db, existing)
    link = models.TeamJoinLink(team_id=team_id, created_by=coach.id,
                               code=secrets.token_urlsafe(9))
    db.add(link)
    db.commit()
    db.refresh(link)
    return _link_out(db, link)


@link_router.post("/link/{link_id}/revoke")
def revoke_join_link(
    link_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Kill my link. Only mine — an assistant's link for the same team is theirs."""
    from datetime import datetime

    link = db.get(models.TeamJoinLink, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    if link.created_by != coach.id:
        raise HTTPException(
            status_code=403,
            detail="This link belongs to whoever created it. They can revoke it.",
        )
    link.revoked_at = datetime.utcnow()
    db.commit()
    return {"ok": True}
