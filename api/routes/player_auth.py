"""Player authentication routes."""

from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from jose import jwt
from passlib.context import CryptContext
from ..database import get_db
from .. import models, schemas

SECRET_KEY = "bloomprint-player-secret-change-in-prod"
ALGORITHM = "HS256"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
player_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/player-auth/login")

router = APIRouter(prefix="/player-auth", tags=["player-auth"])


def _make_token(player_user_id: int) -> str:
    return jwt.encode(
        {"sub": f"player:{player_user_id}", "exp": datetime.utcnow() + timedelta(days=30)},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def get_current_player_user(
    token: str = Depends(player_oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.PlayerUser:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub", "")
        if not sub.startswith("player:"):
            raise ValueError("Not a player token")
        player_user_id = int(sub.split(":")[1])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid player token")
    pu = db.get(models.PlayerUser, player_user_id)
    if not pu:
        raise HTTPException(status_code=401, detail="Player user not found")
    return pu


@router.post("/register", response_model=schemas.PlayerToken)
def register(body: schemas.PlayerUserCreate, db: Session = Depends(get_db)):
    if db.query(models.PlayerUser).filter_by(email=body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    pu = models.PlayerUser(
        name=body.name,
        email=body.email,
        password_hash=pwd_context.hash(body.password),
    )
    db.add(pu)
    db.commit()
    db.refresh(pu)
    return schemas.PlayerToken(
        access_token=_make_token(pu.id),
        player_user=schemas.PlayerUserOut.model_validate(pu),
    )


@router.post("/login", response_model=schemas.PlayerToken)
def login(body: schemas.CoachLogin, db: Session = Depends(get_db)):
    pu = db.query(models.PlayerUser).filter_by(email=body.email).first()
    if not pu or not pwd_context.verify(body.password, pu.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return schemas.PlayerToken(
        access_token=_make_token(pu.id),
        player_user=schemas.PlayerUserOut.model_validate(pu),
    )


@router.get("/me", response_model=schemas.PlayerUserOut)
def me(pu: models.PlayerUser = Depends(get_current_player_user)):
    return pu
