from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models, schemas
from ..auth import hash_password, verify_password, create_token, get_current_coach

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=schemas.Token)
def register(body: schemas.CoachCreate, db: Session = Depends(get_db)):
    if db.query(models.Coach).filter_by(email=body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    coach = models.Coach(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        weight=body.weight,
        level=body.level,
        program_name=body.program_name,
    )
    db.add(coach)
    db.commit()
    db.refresh(coach)
    return {"access_token": create_token(coach.id), "coach": coach}


@router.post("/login", response_model=schemas.Token)
def login(body: schemas.CoachLogin, db: Session = Depends(get_db)):
    coach = db.query(models.Coach).filter_by(email=body.email).first()
    if not coach or not verify_password(body.password, coach.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"access_token": create_token(coach.id), "coach": coach}


@router.get("/me", response_model=schemas.CoachOut)
def me(coach: models.Coach = Depends(get_current_coach)):
    return coach
