import json
import os
import re

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models, schemas
from ..auth import hash_password, verify_password, create_token, get_current_coach
from ..coach_context import SYSTEM_PROFILE_FIELDS

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
        country=body.country,
        city=body.city,
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
    from ..season import touch_and_maybe_remind
    try:
        touch_and_maybe_remind(db, coach)
        db.commit()
    except Exception:
        db.rollback()
    return {"access_token": create_token(coach.id), "coach": coach}


@router.post("/google")
def google_auth(body: schemas.CoachGoogleAuth, db: Session = Depends(get_db)):
    """Google Sign-In for coaches. Returns either:
      {status:'ok', access_token, coach}         — signed in / created
      {status:'needs_signup', email, name}       — no account; app routes to
                                                    the signup form (prefilled)
    mode='login' never creates; mode='register' creates with the required
    profile fields the user filled in on the signup form."""
    from ..google_auth import verify_google_token, random_unusable_password_hash

    identity = verify_google_token(body.id_token)
    coach = db.query(models.Coach).filter_by(email=identity.email).first()

    if coach:
        if not coach.google_sub and identity.sub:
            coach.google_sub = identity.sub
            db.commit()
            db.refresh(coach)
        return {
            "status": "ok",
            "access_token": create_token(coach.id),
            "coach": schemas.CoachOut.model_validate(coach),
        }

    if body.mode != "register":
        return {"status": "needs_signup", "email": identity.email, "name": identity.name}

    weight = _auto_weight(body.competition_level, body.conference) if body.competition_level else 45
    coach = models.Coach(
        name=identity.name,
        email=identity.email,
        password_hash=random_unusable_password_hash(hash_password),
        weight=weight,
        role=body.role or "coach",
        program_name=body.program_name or identity.name,
        conference=body.conference,
        competition_level=body.competition_level,
        country=body.country,
        city=body.city,
        google_sub=identity.sub or None,
    )
    db.add(coach)
    db.commit()
    db.refresh(coach)
    return {
        "status": "ok",
        "access_token": create_token(coach.id),
        "coach": schemas.CoachOut.model_validate(coach),
    }


@router.get("/me", response_model=schemas.CoachOut)
def me(coach: models.Coach = Depends(get_current_coach), db: Session = Depends(get_db)):
    # Season nudge (calendar rollover per competition level, or dormant return)
    # + stamp activity. Runs on every app-open so it works without game tracking.
    from ..season import touch_and_maybe_remind
    try:
        touch_and_maybe_remind(db, coach)
        db.commit()
    except Exception:
        db.rollback()
    return coach


@router.patch("/me", response_model=schemas.CoachOut)
def update_me(
    body: schemas.CoachUpdate,
    coach: models.Coach = Depends(get_current_coach),
    db: Session = Depends(get_db),
):
    data = body.model_dump(exclude_unset=True)
    for field in ("name", "role", "program_name", "competition_level", "conference", "system_profile", "country", "city", "onboarded"):
        if field in data and data[field] is not None:
            setattr(coach, field, data[field])
    # Recompute BIM authority weight if the competition level/conference changed.
    if "competition_level" in data and coach.competition_level:
        coach.weight = _auto_weight(coach.competition_level, coach.conference)
    db.commit()
    db.refresh(coach)
    return coach


def _extract_json_object(text: str) -> dict:
    """Best-effort: pull the first {...} JSON object out of a model response."""
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text).rstrip("`").strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return {}
    return {}


@router.post("/philosophy/import", response_model=schemas.CoachOut)
def import_philosophy(
    file: UploadFile = File(...),
    coach: models.Coach = Depends(get_current_coach),
    db: Session = Depends(get_db),
):
    """Parse an uploaded coaching-philosophy document: extract details into the
    six philosophy fields (APPENDED to whatever is already there) and keep the
    document, distilled to text, as a standing reference fed to the model on
    every future generation."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=400, detail="AI is not configured on this server (missing ANTHROPIC_API_KEY).")

    # Reuse the training reference extractor (text for docs, media blocks for PDF/images).
    from .training import _extract_reference
    ref_text, ref_media = _extract_reference(file)
    if not ref_text and not ref_media:
        raise HTTPException(status_code=400, detail="Could not read any content from that file.")

    field_keys = [k for k, _ in SYSTEM_PROFILE_FIELDS]
    labels = "\n".join(f"  - {k}: {label}" for k, label in SYSTEM_PROFILE_FIELDS)
    instruction = (
        "You are extracting a basketball coach's PROGRAM PHILOSOPHY from the attached document. "
        "Return ONLY a strict JSON object (no prose, no markdown) with these keys:\n"
        f"{labels}\n"
        "  - reference_summary: string\n\n"
        "For each of the six category keys, pull the details from the document that belong in THAT "
        "category, written as clear notes (empty string if the document says nothing about it). "
        "reference_summary = a thorough plain-text digest of this program's systems, terminology, "
        "development approach, and priorities that should remain available to the model as ongoing "
        "reference. Output ONLY the JSON object."
    )

    content: list[dict] = [{"type": "text", "text": instruction}]
    if ref_text:
        content.append({"type": "text", "text": f"DOCUMENT CONTENT:\n{ref_text}"})
    content.extend(ref_media)

    import anthropic
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=2000,
        messages=[{"role": "user", "content": content}],
    )
    raw = "".join(getattr(b, "text", "") for b in resp.content)
    parsed = _extract_json_object(raw)
    if not parsed:
        raise HTTPException(status_code=502, detail="Could not parse the philosophy from that document. Try a clearer file.")

    # APPEND extracted category details to the existing profile.
    profile = dict(coach.system_profile) if isinstance(coach.system_profile, dict) else {}
    for key in field_keys:
        val = (parsed.get(key) or "").strip()
        if not val:
            continue
        existing = (profile.get(key) or "").strip()
        profile[key] = f"{existing}\n{val}".strip() if existing else val
    coach.system_profile = profile

    # APPEND the distilled document to the standing philosophy reference.
    summary = (parsed.get("reference_summary") or ref_text or "").strip()
    if summary:
        fname = file.filename or "imported document"
        block = f"[Imported from {fname}]\n{summary}"
        existing_ref = (coach.philosophy_reference or "").strip()
        coach.philosophy_reference = f"{existing_ref}\n\n{block}".strip() if existing_ref else block

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
