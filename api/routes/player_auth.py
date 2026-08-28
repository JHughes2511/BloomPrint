"""Player authentication routes."""

from datetime import datetime, timedelta
from fastapi import Request, APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
import bcrypt
from jose import jwt
from ..database import get_db
from .. import emails, models, notify, password_reset, schemas

from ..appsecrets import player_key
from .. import ratelimit

ALGORITHM = "HS256"
player_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/player-auth/login")


def _hash_pw(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_pw(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

router = APIRouter(prefix="/player-auth", tags=["player-auth"])


def _make_token(player_user_id: int, epoch: int = 0) -> str:
    """See create_token in api/auth.py: the epoch is what a reset can revoke."""
    return jwt.encode(
        {"sub": f"player:{player_user_id}", "ep": int(epoch or 0),
         "exp": datetime.utcnow() + timedelta(days=30)},
        player_key(),
        algorithm=ALGORITHM,
    )


def get_current_player_user(
    token: str = Depends(player_oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.PlayerUser:
    try:
        payload = jwt.decode(token, player_key(), algorithms=[ALGORITHM])
        sub = payload.get("sub", "")
        if not sub.startswith("player:"):
            raise ValueError("Not a player token")
        player_user_id = int(sub.split(":")[1])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid player token")
    pu = db.get(models.PlayerUser, player_user_id)
    if not pu:
        raise HTTPException(status_code=401, detail="Player user not found")
    # See create_token in api/auth.py. A missing claim reads as 0 so tokens
    # issued before this existed keep working.
    if int(payload.get("ep", 0)) != int(pu.session_epoch or 0):
        raise HTTPException(status_code=401, detail="Invalid player token")
    if pu.deleted_at is not None:
        raise HTTPException(status_code=401, detail="Invalid player token")
    return pu


@router.post("/register", response_model=schemas.PlayerToken)
def register(request: Request, body: schemas.PlayerUserCreate, db: Session = Depends(get_db)):
    ratelimit.check(request, "player-register")
    if db.query(models.PlayerUser).filter_by(email=body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    pu = models.PlayerUser(
        name=body.name,
        email=body.email,
        password_hash=_hash_pw(body.password),
        country=body.country,
        city=body.city,
        preferred_language=(body.preferred_language or "en"),
    )
    db.add(pu)
    db.commit()
    db.refresh(pu)
    notify.player_event(pu, "signup_player")
    return schemas.PlayerToken(
        access_token=_make_token(pu.id, pu.session_epoch),
        player_user=schemas.PlayerUserOut.model_validate(pu),
    )


@router.post("/login", response_model=schemas.PlayerToken)
def login(request: Request, body: schemas.CoachLogin, db: Session = Depends(get_db)):
    ratelimit.check(request, "player-login")
    pu = db.query(models.PlayerUser).filter_by(email=body.email).first()
    if not pu or not _verify_pw(body.password, pu.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    # See routes/auth.py.
    if pu.deleted_at is not None:
        raise HTTPException(status_code=403, detail="account_closed")
    return schemas.PlayerToken(
        access_token=_make_token(pu.id, pu.session_epoch),
        player_user=schemas.PlayerUserOut.model_validate(pu),
    )


@router.post("/google")
def google_auth(request: Request, body: schemas.PlayerGoogleAuth, db: Session = Depends(get_db)):
    """Google Sign-In for players. Returns either:
      {status:'ok', access_token, player_user}   — signed in / created
      {status:'needs_signup', email, name}       — no account; app routes to
                                                    the signup form (prefilled)
    The player still completes the coach-link flow after a Google signup."""
    ratelimit.check(request, "player-google")
    from ..google_auth import verify_google_token, random_unusable_password_hash

    identity = verify_google_token(body.id_token)
    pu = db.query(models.PlayerUser).filter_by(email=identity.email).first()
    # See routes/auth.py: closed means no account here.
    if pu is not None and pu.deleted_at is not None:
        pu = None

    if pu:
        if not pu.google_sub and identity.sub:
            pu.google_sub = identity.sub
            db.commit()
            db.refresh(pu)
        return {
            "status": "ok",
            "access_token": _make_token(pu.id, pu.session_epoch),
            "player_user": schemas.PlayerUserOut.model_validate(pu),
        }

    if body.mode != "register":
        return {"status": "needs_signup", "email": identity.email, "name": identity.name}

    # The typed name wins over the Google profile name; see the coach route.
    pu = models.PlayerUser(
        name=(body.name or "").strip() or identity.name,
        email=identity.email,
        password_hash=random_unusable_password_hash(_hash_pw),
        country=body.country,
        city=body.city,
        preferred_language=(body.preferred_language or "en"),
        google_sub=identity.sub or None,
    )
    db.add(pu)
    db.commit()
    db.refresh(pu)
    notify.player_event(pu, "signup_player")
    return {
        "status": "ok",
        "access_token": _make_token(pu.id, pu.session_epoch),
        "player_user": schemas.PlayerUserOut.model_validate(pu),
    }


def _player_user_out(pu: models.PlayerUser) -> schemas.PlayerUserOut:
    out = schemas.PlayerUserOut.model_validate(pu)
    if pu.player:
        out.linked_player_name = pu.player.name
        out.linked_team_name = pu.player.team.name if pu.player.team else None
        out.linked_program_name = pu.player.program_name
    return out


@router.get("/me", response_model=schemas.PlayerUserOut)
def me(pu: models.PlayerUser = Depends(get_current_player_user)):
    return _player_user_out(pu)


@router.patch("/me", response_model=schemas.PlayerUserOut)
def update_me(
    body: schemas.PlayerUserUpdate,
    db: Session = Depends(get_db),
    pu: models.PlayerUser = Depends(get_current_player_user),
):
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] and data["name"].strip():
        pu.name = data["name"].strip()
    if "avatar" in data:
        pu.avatar = data["avatar"] or None
    if "country" in data:
        pu.country = data["country"] or None
    if "city" in data:
        pu.city = data["city"] or None
    if data.get("preferred_language"):
        pu.preferred_language = data["preferred_language"]
    db.commit()
    db.refresh(pu)
    return _player_user_out(pu)


@router.get("/linked-player", response_model=schemas.PlayerOut)
def get_linked_player(
    pu: models.PlayerUser = Depends(get_current_player_user),
    db: Session = Depends(get_db),
):
    if not pu.player_id:
        raise HTTPException(status_code=404, detail="No linked player profile")
    player = db.get(models.Player, pu.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    # The player's composite aggregates only the evals that coaches have SHARED
    # with them (from any coach) — an accurate score across all sides. Unshared
    # evals stay private to their creating coach.
    from .players import _with_grade
    shared_eval_ids = {
        sr.evaluation_id
        for sr in db.query(models.SharedReport).filter_by(player_user_id=pu.id).all()
        if sr.evaluation_id
    }
    shared_evals = [e for e in player.evaluations if e.id in shared_eval_ids]
    return _with_grade(player, shared_evals)


class PlayerSelfUpdate(BaseModel):
    """What a player may change about themselves on a coach's roster.

    Facts about the athlete, not about the program. Jersey number and notes stay
    with the coach: a number varies by team, and notes are the coach's own record
    of the player rather than the player's. Name is deliberately absent too — the
    roster keeps whatever the coach calls them, and the linked account name is
    shown alongside instead.

    Competition level IS the player's to set. It reads like a property of the
    team, but a player knows what level they are playing at — and when they move
    up, they know before anyone updates a roster.
    """
    position: str | None = None
    height: str | None = None
    wingspan: str | None = None
    weight: str | None = None
    standing_reach: str | None = None
    country: str | None = None
    state: str | None = None
    city: str | None = None
    school_name: str | None = None
    age: int | None = None
    competition_level: str | None = None


@router.patch("/linked-player", response_model=schemas.PlayerOut)
def update_linked_player(
    body: PlayerSelfUpdate,
    pu: models.PlayerUser = Depends(get_current_player_user),
    db: Session = Depends(get_db),
):
    if not pu.player_id:
        raise HTTPException(status_code=404, detail="No linked player profile")
    player = db.get(models.Player, pu.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    # Every roster this account is linked to, not just the primary one. A player
    # on two coaches' rosters is one person: measuring themselves once should not
    # leave the second coach with last season's height. The player is the
    # authority on these facts, and either side may edit them afterwards.
    linked_ids = {
        row.player_id for row in
        db.query(models.PlayerUserLink).filter_by(player_user_id=pu.id).all()
    }
    linked_ids.add(pu.player_id)

    fields = ("position", "height", "wingspan", "weight", "standing_reach",
              "country", "state", "city", "school_name", "age",
              "competition_level")
    for pid in linked_ids:
        target = db.get(models.Player, pid)
        if not target:
            continue
        for field in fields:
            val = getattr(body, field)
            if val is not None:
                setattr(target, field, val)
    db.commit()
    db.refresh(player)
    return schemas.PlayerOut.model_validate(player)


# ── Getting back in ───────────────────────────────────────────────────────────
#
# The coach's equivalents live in routes/auth.py and the reasoning is written
# out there. The shared half is api/password_reset.py, deliberately, so the
# security properties cannot come to differ between the two audiences.


class PlayerPasswordResetRequest(BaseModel):
    email: str


class PlayerPasswordResetConfirm(BaseModel):
    token: str
    password: str


@router.post("/password-reset/request")
def request_player_password_reset(request: Request, body: PlayerPasswordResetRequest,
                                  db: Session = Depends(get_db)):
    """Send a reset link, if that address has a player account.

    Answers the same whether it did or not: see routes/auth.py.
    """
    ratelimit.check(request, "player-password-reset")
    email = (body.email or "").strip().lower()
    pu = db.query(models.PlayerUser).filter(
        func.lower(models.PlayerUser.email) == email).first() if email else None
    if pu:
        token = password_reset.issue(db, password_reset.PLAYER, pu.id)
        notify.player_event(pu, "password_reset",
                            link=f"{emails.app_url()}/reset-password?token={token}&as=player")
    return {"ok": True}


@router.post("/password-reset/confirm", response_model=schemas.PlayerToken)
def confirm_player_password_reset(request: Request, body: PlayerPasswordResetConfirm,
                                  db: Session = Depends(get_db)):
    ratelimit.check(request, "player-password-reset-confirm")
    if len(body.password or "") < 8:
        raise HTTPException(status_code=400,
                            detail="Password must be at least 8 characters.")
    row = password_reset.redeem(db, body.token, password_reset.PLAYER)
    if row is None:
        raise HTTPException(status_code=400,
                            detail="That reset link has expired or has already been used.")
    pu = password_reset.account_for(db, row)
    if pu is None:
        raise HTTPException(status_code=400, detail="That account no longer exists.")

    pu.password_hash = _hash_pw(body.password)
    password_reset.end_all_sessions(pu)
    db.commit()
    db.refresh(pu)

    notify.player_event(
        pu, "password_changed",
        link=f"{emails.app_url()}/reset-password"
             f"?token={password_reset.issue(db, password_reset.PLAYER, pu.id)}&as=player")
    return schemas.PlayerToken(access_token=_make_token(pu.id, pu.session_epoch),
                               player_user=pu)
