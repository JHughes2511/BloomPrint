from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models, schemas
from ..auth import hash_password, verify_password, create_token, get_current_coach

router = APIRouter(prefix="/auth", tags=["auth"])

D1_HIGH_MAJOR_CONFERENCES = {"Big Ten", "Big 12", "ACC", "Big East", "SEC"}


def _auto_weight(competition_level: str, conference: str | None) -> int:
    """Assign a BIM authority weight based on competition level."""
    lvl = (competition_level or "").strip()
    if lvl == "Pro":
        return 98
    if lvl == "College":
        if conference and conference.strip() in D1_HIGH_MAJOR_CONFERENCES:
            return 82
        return 75
    if lvl == "AAU":
        return 40
    if lvl == "HS Varsity":
        return 45
    if lvl in ("HS JV", "Middle School"):
        return 35
    return 45


@router.post("/register", response_model=schemas.Token)
def register(body: schemas.CoachCreate, db: Session = Depends(get_db)):
    if db.query(models.Coach).filter_by(email=body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    # Auto-assign weight from competition_level if not explicitly provided
    weight = _auto_weight(body.competition_level, body.conference) if body.competition_level else body.weight
    coach = models.Coach(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        weight=weight,
        level=body.level,
        program_name=body.program_name,
        role=body.role,
        conference=body.conference,
        competition_level=body.competition_level,
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


@router.patch("/me", response_model=schemas.CoachOut)
def update_me(
    body: schemas.CoachUpdate,
    coach: models.Coach = Depends(get_current_coach),
    db: Session = Depends(get_db),
):
    data = body.model_dump(exclude_unset=True)
    for field in ("name", "role", "program_name", "competition_level", "conference", "system_profile"):
        if field in data and data[field] is not None:
            setattr(coach, field, data[field])
    # Recompute BIM authority weight if the competition level/conference changed.
    if "competition_level" in data and coach.competition_level:
        coach.weight = _auto_weight(coach.competition_level, coach.conference)
    db.commit()
    db.refresh(coach)
    return coach


@router.get("/coaches")
def list_coaches(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """List all coaches/scouts/trainers (excluding self)."""
    results = (
        db.query(models.Coach)
        .filter(models.Coach.id != coach.id)
        .order_by(models.Coach.name)
        .limit(100)
        .all()
    )
    return [
        {"id": c.id, "name": c.name, "role": c.role, "program_name": c.program_name}
        for c in results
    ]


@router.get("/coaches/search")
def search_coaches(
    q: str = "",
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Search coach/trainer/scout accounts by name."""
    results = (
        db.query(models.Coach)
        .filter(
            (models.Coach.name.ilike(f"%{q}%")) |
            (models.Coach.program_name.ilike(f"%{q}%"))
        )
        .filter(models.Coach.id != coach.id)
        .limit(15)
        .all()
    )
    return [
        {"id": c.id, "name": c.name, "role": c.role, "program_name": c.program_name}
        for c in results
    ]
