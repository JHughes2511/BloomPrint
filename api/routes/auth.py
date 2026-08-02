import json
import os
import re

from fastapi import Request, APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models, notify, schemas
from ..auth import hash_password, verify_password, create_token, get_current_coach
from ..coach_context import SYSTEM_PROFILE_FIELDS
from ..ai_models import SONNET
from .. import ratelimit

router = APIRouter(prefix="/auth", tags=["auth"])

D1_HIGH_MAJOR_CONFERENCES = {"Big Ten", "Big 12", "ACC", "Big East", "SEC"}


def _auto_weight(competition_level: str, conference: str | None) -> int:
    """Assign a BIM authority weight based on competition level. Weights train the
    model's calibration, so keep this in sync with the coach-facing level list
    (mobile/src/constants/levels.ts)."""
    lvl = (competition_level or "").strip()
    if lvl == "Pro":
        return 98
    if lvl == "College":
        if conference and conference.strip() in D1_HIGH_MAJOR_CONFERENCES:
            return 82
        return 75
    if lvl == "JUCO":
        return 60
    if lvl == "Prep School":
        return 50
    if lvl == "HS Varsity":
        return 45
    if lvl == "AAU":
        return 40
    if lvl == "HS JV":
        return 35
    if lvl == "Middle School":
        return 30
    if lvl == "Youth":
        return 25
    return 45


@router.post("/register", response_model=schemas.Token)
def register(request: Request, body: schemas.CoachCreate, db: Session = Depends(get_db)):
    ratelimit.check(request, "coach-register")
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
        competition_level=(body.competition_level or "HS Varsity"),
        country=body.country,
        city=body.city,
        preferred_language=(body.preferred_language or "en"),
    )
    db.add(coach)
    db.commit()
    db.refresh(coach)
    notify.coach_event(coach, "signup_coach")
    return {"access_token": create_token(coach.id), "coach": coach}


@router.post("/login", response_model=schemas.Token)
def login(request: Request, body: schemas.CoachLogin, db: Session = Depends(get_db)):
    ratelimit.check(request, "coach-login")
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
def google_auth(request: Request, body: schemas.CoachGoogleAuth, db: Session = Depends(get_db)):
    """Google Sign-In for coaches. Returns either:
      {status:'ok', access_token, coach}         — signed in / created
      {status:'needs_signup', email, name}       — no account; app routes to
                                                    the signup form (prefilled)
    mode='login' never creates; mode='register' creates with the required
    profile fields the user filled in on the signup form."""
    ratelimit.check(request, "coach-google")
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
    # What the person typed wins over what Google knows them as; the Google name
    # is only the prefill. Falls back to the identity when the form sent nothing,
    # which keeps older clients working.
    chosen_name = (body.name or "").strip() or identity.name
    coach = models.Coach(
        name=chosen_name,
        email=identity.email,
        password_hash=random_unusable_password_hash(hash_password),
        weight=weight,
        role=body.role or "coach",
        program_name=body.program_name or chosen_name,
        conference=body.conference,
        competition_level=(body.competition_level or "HS Varsity"),
        country=body.country,
        city=body.city,
        preferred_language=(body.preferred_language or "en"),
        google_sub=identity.sub or None,
    )
    db.add(coach)
    db.commit()
    db.refresh(coach)
    notify.coach_event(coach, "signup_coach")
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
    # Email is the login identity — change it directly but reject a duplicate.
    email_changed_from: str | None = None
    if "email" in data and data["email"]:
        new_email = data["email"].strip().lower()
        if new_email and new_email != (coach.email or "").lower():
            taken = db.query(models.Coach).filter(models.Coach.email == new_email, models.Coach.id != coach.id).first()
            if taken:
                raise HTTPException(status_code=400, detail="That email is already used by another account.")
            email_changed_from = coach.email
            coach.email = new_email
    for field in ("name", "role", "program_name", "competition_level", "conference", "system_profile", "country", "city", "onboarded", "preferred_language"):
        if field in data and data[field] is not None:
            setattr(coach, field, data[field])
    # Recompute BIM authority weight if the competition level/conference changed.
    if "competition_level" in data and coach.competition_level:
        coach.weight = _auto_weight(coach.competition_level, coach.conference)
    db.commit()
    db.refresh(coach)
    if email_changed_from:
        # Both addresses are told. The new one confirms the change took; the old
        # one is the only warning someone gets if they did not make it, and it
        # is the address an attacker has just locked them out of.
        notify.coach_event(coach, "email_changed", {"email": coach.email})
        notify.send_event("coach", coach.id, "email_changed",
                          to=email_changed_from, lang=coach.preferred_language,
                          params={"name": coach.name, "email": coach.email})
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
        model=SONNET,
        # Six category fields plus a "thorough" reference_summary — this asks for
        # a lot of JSON, and a truncated object parses as nothing rather than as
        # a partial profile. Budgeted generously; unused tokens aren't billed.
        max_tokens=6000,
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
