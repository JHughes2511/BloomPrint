"""Staff-team linking routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..auth import get_current_coach
from .. import models

router = APIRouter(prefix="/team-staff", tags=["team-staff"])


class TeamOut(BaseModel):
    id: int
    name: str
    competition_level: str | None = None
    coach_name: str | None = None
    parent_team_id: int | None = None
    member_count: int | None = None
    is_owner: bool | None = None
    model_config = {"from_attributes": True}


def _can_manage(db: Session, team_id: int, coach_id: int) -> bool:
    """Owner OR any staff member of the team can create sub-teams / invite."""
    team = db.get(models.Team, team_id)
    if not team:
        return False
    if team.coach_id == coach_id:
        return True
    return db.query(models.TeamStaff).filter_by(team_id=team_id, coach_id=coach_id).first() is not None


def _member_count(db: Session, team_id: int) -> int:
    staff = db.query(models.TeamStaff).filter_by(team_id=team_id).count()
    return staff + 1  # + owner


class TeamGameItem(BaseModel):
    id: int
    kind: str          # "session" | "report"
    title: str
    date: str | None = None
    report_text: str | None = None
    ai_scouting_report: str | None = None
    our_score: int | None = None
    opponent_score: int | None = None
    model_config = {"from_attributes": True}


@router.get("/search", response_model=list[TeamOut])
def search_teams(
    q: str = "",
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Search all teams by name so staff can find programs to join."""
    teams = (
        db.query(models.Team)
        .filter(models.Team.name.ilike(f"%{q}%"))
        .limit(20)
        .all()
    )
    result = []
    for t in teams:
        owner = db.get(models.Coach, t.coach_id)
        result.append(TeamOut(
            id=t.id,
            name=t.name,
            competition_level=t.competition_level,
            coach_name=owner.name if owner else None,
        ))
    return result


@router.post("/{team_id}/join")
def join_team(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Ask to join a team. The owner approves or rejects.

    Joining used to be automatic, which made team membership self-service: any
    coach could add themselves and immediately read every game, report and
    notification belonging to that team. Membership is what the visibility
    checks elsewhere are built on, so it has to be granted, not taken.
    """
    team = db.get(models.Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if team.coach_id == coach.id:
        raise HTTPException(status_code=400, detail="You already own this team")

    if db.query(models.TeamStaff).filter_by(coach_id=coach.id, team_id=team_id).first():
        return {"ok": True, "already_member": True, "status": "approved"}

    pending = (
        db.query(models.TeamInvite)
        .filter_by(team_id=team_id, invited_coach_id=coach.id, kind="request", status="pending")
        .first()
    )
    if pending:
        return {"ok": True, "status": "pending", "already_requested": True}

    # An owner-issued invite already waiting for this coach is a straight yes —
    # both sides have now agreed, so don't make the owner approve twice.
    invited = (
        db.query(models.TeamInvite)
        .filter_by(team_id=team_id, invited_coach_id=coach.id, kind="invite", status="pending")
        .first()
    )
    if invited:
        invited.status = "approved"
        db.add(models.TeamStaff(coach_id=coach.id, team_id=team_id))
        _notify_owner_joined(db, team, coach)
        db.commit()
        return {"ok": True, "status": "approved"}

    req = models.TeamInvite(
        team_id=team_id, invited_by=coach.id, invited_coach_id=coach.id,
        kind="request", status="pending",
    )
    db.add(req)
    db.flush()
    db.add(models.CoachNotification(
        coach_id=team.coach_id,
        title=f"{coach.name} asked to join your team",
        body=f"{coach.name} ({coach.role or 'staff'}) asked to join {team.name}.",
        i18n_key="notifs.teamJoinRequest",
        i18n_params={"coach": coach.name, "role": coach.role or "staff", "team": team.name},
        type="team_join_request",
        ref_id=req.id,
    ))
    db.commit()
    return {"ok": True, "status": "pending"}


def _notify_owner_joined(db: Session, team, coach) -> None:
    db.add(models.CoachNotification(
        coach_id=team.coach_id,
        title=f"{coach.name} joined your team",
        body=f"{coach.name} ({coach.role or 'staff'}) has joined {team.name}.",
        i18n_key="notifs.teamStaffJoined",
        i18n_params={"coach": coach.name, "role": coach.role or "staff", "team": team.name},
        type="team_staff_joined",
    ))


def _get_join_request(db: Session, request_id: int, owner_id: int):
    """A pending join request on a team this coach owns."""
    req = db.get(models.TeamInvite, request_id)
    if not req or req.kind != "request":
        raise HTTPException(status_code=404, detail="Join request not found")
    team = db.get(models.Team, req.team_id)
    if not team or team.coach_id != owner_id:
        raise HTTPException(status_code=404, detail="Join request not found")
    return req, team


@router.get("/join-requests")
def my_join_requests(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Pending requests to join any team this coach owns."""
    team_ids = [t.id for t in db.query(models.Team).filter_by(coach_id=coach.id).all()]
    if not team_ids:
        return []
    rows = (
        db.query(models.TeamInvite)
        .filter(
            models.TeamInvite.team_id.in_(team_ids),
            models.TeamInvite.kind == "request",
            models.TeamInvite.status == "pending",
        )
        .all()
    )
    out = []
    for req in rows:
        team = db.get(models.Team, req.team_id)
        applicant = db.get(models.Coach, req.invited_coach_id)
        out.append({
            "id": req.id,
            "team_id": req.team_id,
            "team_name": team.name if team else "Team",
            "coach_id": req.invited_coach_id,
            "coach_name": applicant.name if applicant else "A coach",
            "coach_role": (applicant.role if applicant else None) or "staff",
            "created_at": req.created_at,
        })
    return out


@router.post("/join-requests/{request_id}/approve")
def approve_join_request(
    request_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    req, team = _get_join_request(db, request_id, coach.id)
    if req.status == "pending":
        if not db.query(models.TeamStaff).filter_by(team_id=req.team_id, coach_id=req.invited_coach_id).first():
            db.add(models.TeamStaff(team_id=req.team_id, coach_id=req.invited_coach_id))
        req.status = "approved"
        db.add(models.CoachNotification(
            coach_id=req.invited_coach_id,
            title="Join request approved",
            body=f"You are now staff on {team.name}.",
            i18n_key="notifs.teamJoinApproved",
            i18n_params={"team": team.name},
            type="team_join_approved",
        ))
        db.commit()
    return {"ok": True, "status": req.status}


@router.post("/join-requests/{request_id}/reject")
def reject_join_request(
    request_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    req, team = _get_join_request(db, request_id, coach.id)
    if req.status == "pending":
        req.status = "rejected"
        db.add(models.CoachNotification(
            coach_id=req.invited_coach_id,
            title="Join request declined",
            body=f"Your request to join {team.name} was declined.",
            i18n_key="notifs.teamJoinRejected",
            i18n_params={"team": team.name},
            type="team_join_rejected",
        ))
        db.commit()
    return {"ok": True, "status": req.status}


@router.delete("/{team_id}/leave")
def leave_team(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Disconnect from a team — stops all game visibility and notifications."""
    link = (
        db.query(models.TeamStaff)
        .filter_by(coach_id=coach.id, team_id=team_id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Not a member of this team")
    db.delete(link)
    db.commit()
    return {"ok": True}


@router.get("/my-teams", response_model=list[TeamOut])
def my_teams(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Teams this coach owns OR joined, plus their ancestor teams so the nested
    sub-team breakout can be rendered."""
    teams: dict[int, models.Team] = {}
    for t in db.query(models.Team).filter_by(coach_id=coach.id).all():
        teams[t.id] = t
    joined_ids = [l.team_id for l in db.query(models.TeamStaff).filter_by(coach_id=coach.id).all()]
    if joined_ids:
        for t in db.query(models.Team).filter(models.Team.id.in_(joined_ids)).all():
            teams[t.id] = t
    # Pull in ancestors so the tree has parents for context.
    for t in list(teams.values()):
        cur = t
        while cur is not None and cur.parent_team_id and cur.parent_team_id not in teams:
            parent = db.get(models.Team, cur.parent_team_id)
            if not parent:
                break
            teams[parent.id] = parent
            cur = parent
    result = []
    for t in teams.values():
        owner = db.get(models.Coach, t.coach_id)
        result.append(TeamOut(
            id=t.id, name=t.name, competition_level=t.competition_level,
            coach_name=owner.name if owner else None,
            parent_team_id=t.parent_team_id,
            member_count=_member_count(db, t.id),
            is_owner=(t.coach_id == coach.id),
        ))
    return result


@router.post("/{team_id}/subteam", response_model=TeamOut)
def create_subteam(
    team_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    parent = db.get(models.Team, team_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Team not found")
    if not _can_manage(db, team_id, coach.id):
        raise HTTPException(status_code=403, detail="Only the team owner or its staff can create a sub-team.")
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Give the sub-team a name.")
    sub = models.Team(name=name, coach_id=coach.id, competition_level=parent.competition_level, parent_team_id=team_id)
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return TeamOut(id=sub.id, name=sub.name, competition_level=sub.competition_level,
                   coach_name=coach.name, parent_team_id=team_id, member_count=1, is_owner=True)


@router.get("/{team_id}/subteams", response_model=list[TeamOut])
def list_subteams(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    subs = db.query(models.Team).filter_by(parent_team_id=team_id).order_by(models.Team.name).all()
    out = []
    for s in subs:
        owner = db.get(models.Coach, s.coach_id)
        out.append(TeamOut(id=s.id, name=s.name, competition_level=s.competition_level,
                           coach_name=owner.name if owner else None, parent_team_id=team_id,
                           member_count=_member_count(db, s.id),
                           is_owner=(s.coach_id == coach.id)))
    return out


@router.get("/{team_id}/members")
def list_members(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    team = db.get(models.Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    ids = {team.coach_id, *[l.coach_id for l in db.query(models.TeamStaff).filter_by(team_id=team_id).all()]}
    coaches = db.query(models.Coach).filter(models.Coach.id.in_(ids)).all() if ids else []
    return [{"id": c.id, "name": c.name, "role": c.role, "is_owner": c.id == team.coach_id} for c in coaches]


@router.post("/{team_id}/invite")
def invite_to_team(
    team_id: int,
    body: dict,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    import secrets
    team = db.get(models.Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if not _can_manage(db, team_id, coach.id):
        raise HTTPException(status_code=403, detail="Only the team owner or its staff can invite.")
    target_coach_id = body.get("coach_id")
    email = (body.get("email") or "").strip().lower()
    target = None
    if target_coach_id:
        target = db.get(models.Coach, int(target_coach_id))
    elif email:
        target = db.query(models.Coach).filter(models.Coach.email == email).first()

    if target:
        if target.id == team.coach_id or db.query(models.TeamStaff).filter_by(team_id=team_id, coach_id=target.id).first():
            raise HTTPException(status_code=400, detail=f"{target.name} is already on this team.")
        inv = models.TeamInvite(team_id=team_id, invited_by=coach.id, invited_coach_id=target.id, status="pending")
        db.add(inv)
        db.flush()
        db.add(models.PlayerNotification(
            coach_id=target.id,
            type="team_invite",
            title="Team invite",
            body=f"{coach.name} invited you to join {team.name}.",
            i18n_key="notifs.teamInvite", i18n_params={"coach": coach.name, "team": team.name},
            ref_id=inv.id,
        ))
        db.commit()
        return {"status": "invited", "name": target.name}

    if not email:
        raise HTTPException(status_code=400, detail="Enter a coach name or email to invite.")
    # Unknown email — create a coded invite. Actual email send is gated on SMTP.
    code = secrets.token_urlsafe(8).upper()
    inv = models.TeamInvite(team_id=team_id, invited_by=coach.id, invited_email=email, code=code, status="pending")
    db.add(inv)
    db.commit()
    from ..email_invite import send_team_invite_email
    sent = send_team_invite_email(email, coach.name, team.name, code)
    return {"status": "email_invite", "email": email, "code": code, "email_sent": sent}


@router.get("/invites")
def my_invites(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    # kind="invite" only: a join request this coach raised is waiting on the
    # team owner, not on them, and must not appear as something to accept.
    rows = (
        db.query(models.TeamInvite)
        .filter_by(invited_coach_id=coach.id, status="pending", kind="invite")
        .all()
    )
    out = []
    for inv in rows:
        team = db.get(models.Team, inv.team_id)
        inviter = db.get(models.Coach, inv.invited_by)
        out.append({
            "id": inv.id,
            "team_id": inv.team_id,
            "team_name": team.name if team else "Team",
            "inviter_name": inviter.name if inviter else "A coach",
            "created_at": inv.created_at,
        })
    return out


@router.post("/invites/{invite_id}/approve")
def approve_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    # kind must be "invite". On a join-request row invited_coach_id is the
    # requester, so without this check a coach could approve their own request
    # here and grant themselves the membership the owner never agreed to.
    inv = db.get(models.TeamInvite, invite_id)
    if not inv or inv.kind != "invite" or inv.invited_coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Invite not found")
    if inv.status == "pending":
        if not db.query(models.TeamStaff).filter_by(team_id=inv.team_id, coach_id=coach.id).first():
            db.add(models.TeamStaff(team_id=inv.team_id, coach_id=coach.id))
        inv.status = "approved"
        team = db.get(models.Team, inv.team_id)
        db.add(models.PlayerNotification(
            coach_id=inv.invited_by, type="team_invite_approved", title="Invite accepted",
            body=f"{coach.name} joined {team.name if team else 'your team'}.",
            i18n_key="notifs.teamInviteAccepted",
            i18n_params={"coach": coach.name, "team": team.name if team else None},
        ))
        db.commit()
    return {"ok": True, "status": inv.status}


@router.post("/invites/{invite_id}/reject")
def reject_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    # kind must be "invite". On a join-request row invited_coach_id is the
    # requester, so without this check a coach could approve their own request
    # here and grant themselves the membership the owner never agreed to.
    inv = db.get(models.TeamInvite, invite_id)
    if not inv or inv.kind != "invite" or inv.invited_coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Invite not found")
    if inv.status == "pending":
        inv.status = "rejected"
        db.add(models.PlayerNotification(
            coach_id=inv.invited_by, type="team_invite_rejected", title="Invite declined",
            body=f"{coach.name} declined the team invite.",
            i18n_key="notifs.teamInviteRejected", i18n_params={"coach": coach.name},
        ))
        db.commit()
    return {"ok": True, "status": inv.status}


class TransferOwnerBody(BaseModel):
    coach_id: int | None = None   # omit to claim an orphaned team yourself


def _team_and_subteams(db: Session, team) -> list:
    """The team plus every sub-team beneath it that shares its owner.

    Ownership has to move as a unit. Leaving sub-teams behind would strand them
    under a coach who no longer runs the program, and nobody could then reassign
    them because the transfer endpoint only accepts the current owner.
    """
    out, frontier = [team], [team.id]
    while frontier:
        children = (
            db.query(models.Team)
            .filter(models.Team.parent_team_id.in_(frontier))
            .all()
        )
        children = [c for c in children if c.coach_id == team.coach_id]
        if not children:
            break
        out.extend(children)
        frontier = [c.id for c in children]
    return out


@router.post("/{team_id}/transfer-owner")
def transfer_owner(
    team_id: int,
    body: TransferOwnerBody,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Hand a team to another coach.

    Normally the current owner names their successor. If the owner's account is
    gone — they left the app — the team would otherwise be frozen forever, with
    no one able to invite, rename or reassign it, so any staff member may claim
    it. Claiming is limited to existing staff: it must not become a way for an
    outsider to take over a team by watching for a deleted account.
    """
    team = db.get(models.Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    owner = db.get(models.Coach, team.coach_id)
    orphaned = owner is None
    is_owner = team.coach_id == coach.id
    is_staff = db.query(models.TeamStaff).filter_by(team_id=team_id, coach_id=coach.id).first() is not None

    if is_owner:
        if body.coach_id is None:
            raise HTTPException(status_code=400, detail="Choose the coach to hand the team to.")
        new_owner_id = body.coach_id
    elif orphaned and is_staff:
        # Reclaiming a team whose owner is gone: you may only claim it yourself,
        # not hand it to a third party.
        new_owner_id = coach.id
    else:
        raise HTTPException(status_code=403, detail="Only the team owner can transfer this team.")

    if new_owner_id == team.coach_id:
        raise HTTPException(status_code=400, detail="That coach already owns this team.")

    new_owner = db.get(models.Coach, new_owner_id)
    if not new_owner:
        raise HTTPException(status_code=404, detail="Coach not found")
    if new_owner_id != coach.id and not db.query(models.TeamStaff).filter_by(
        team_id=team_id, coach_id=new_owner_id
    ).first():
        raise HTTPException(status_code=400, detail="Hand the team to someone already on its staff.")

    moved = _team_and_subteams(db, team)
    previous_owner_id = team.coach_id
    for t in moved:
        t.coach_id = new_owner_id

    for t in moved:
        # The new owner is no longer merely staff.
        link = db.query(models.TeamStaff).filter_by(team_id=t.id, coach_id=new_owner_id).first()
        if link:
            db.delete(link)
        # The outgoing owner keeps access as staff rather than being locked out
        # of a program they still work in. They can leave if they want to.
        if not orphaned and not db.query(models.TeamStaff).filter_by(
            team_id=t.id, coach_id=previous_owner_id
        ).first():
            db.add(models.TeamStaff(team_id=t.id, coach_id=previous_owner_id))

    db.add(models.CoachNotification(
        coach_id=new_owner_id,
        title=f"You now own {team.name}",
        body=f"{coach.name} made you the owner of {team.name}.",
        i18n_key="notifs.teamOwnerChanged",
        i18n_params={"coach": coach.name, "team": team.name},
        type="team_owner_changed",
    ))
    if not orphaned and previous_owner_id != coach.id:
        db.add(models.CoachNotification(
            coach_id=previous_owner_id,
            title=f"{new_owner.name} now owns {team.name}",
            body=f"{new_owner.name} is now the owner of {team.name}.",
            i18n_key="notifs.teamOwnerChanged",
            i18n_params={"coach": new_owner.name, "team": team.name},
            type="team_owner_changed",
        ))
    db.commit()
    return {
        "ok": True,
        "team_id": team.id,
        "new_owner_id": new_owner_id,
        "teams_moved": len(moved),
        "claimed": orphaned and not is_owner,
    }


@router.get("/team-games")
def team_games(
    team_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Return all game sessions + reports for a team.
    Caller must own the team or be a linked staff member.
    """
    team = db.get(models.Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Check access
    is_owner = team.coach_id == coach.id
    is_staff = (
        db.query(models.TeamStaff)
        .filter_by(coach_id=coach.id, team_id=team_id)
        .first()
    ) is not None

    if not is_owner and not is_staff:
        raise HTTPException(status_code=403, detail="Not a member of this team")

    items = []

    # Game sessions for this team
    sessions = (
        db.query(models.GameSession)
        .filter_by(team_id=team_id)
        .order_by(models.GameSession.id.desc())
        .all()
    )
    for s in sessions:
        date_str = s.date.strftime("%B %d, %Y") if s.date else None
        score_str = ""
        if s.our_score is not None and s.opponent_score is not None:
            result_word = "W" if s.our_score > s.opponent_score else ("L" if s.our_score < s.opponent_score else "T")
            score_str = f"{result_word} {s.our_score}-{s.opponent_score}"
        items.append({
            "id": s.id,
            "kind": "session",
            "title": f"vs {s.opponent_name}" + (f" ({score_str})" if score_str else ""),
            "date": date_str,
            "ai_scouting_report": s.ai_scouting_report,
            "our_score": s.our_score,
            "opponent_score": s.opponent_score,
        })

    # Game reports linked to this team (as home or away)
    reports = (
        db.query(models.GameReport)
        .filter(
            (models.GameReport.my_team_id == team_id) |
            (models.GameReport.opponent_team_id == team_id)
        )
        .order_by(models.GameReport.id.desc())
        .all()
    )
    for r in reports:
        items.append({
            "id": r.id,
            "kind": "report",
            "title": r.title or r.opponent_name or "Game Report",
            "date": r.created_at.strftime("%B %d, %Y") if r.created_at else None,
            "report_text": r.report_text,
        })

    return {"team": {"id": team.id, "name": team.name}, "items": items}
