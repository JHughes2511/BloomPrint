"""What BloomPrint has learned a coach cares about, and reading it back.

Every correction a coach makes is them saying what the report should have been
paying attention to. Verifying it against the film fixes one report. Keeping it
is what stops them writing the same note again next week — and what makes the
next report about that team start where the last conversation ended.

Readable and deletable on purpose. A standing instruction the coach cannot see
is a report that quietly drifts for reasons nobody can point at, and teams
change across a season: what mattered against Angola in November is not
necessarily true of them in March.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models

router = APIRouter(prefix="/preferences", tags=["preferences"])

# Long enough for a real coaching note, short enough that a pasted report
# cannot become a standing instruction on every future generation.
MAX_LEN = 400

# How many are ever fed to a generation. A prompt that accumulates without
# limit gets slower and vaguer with every correction, which is the opposite of
# what remembering them is for; the most recent are the ones that still hold.
MAX_APPLIED = 12


class PreferenceOut(BaseModel):
    id: int
    team_id: int | None = None
    team_name: str | None = None
    text: str
    source: str = "correction"
    active: bool = True
    created_at: str

    model_config = {"from_attributes": True}


class PreferenceUpdate(BaseModel):
    active: bool


def remember(db: Session, coach_id: int, text: str, team_id: int | None,
             source: str = "correction") -> models.CoachPreference | None:
    """Record what a correction taught, unless we already know it.

    Same coach, same team, same words means the coach is repeating themselves
    because the last one did not take — storing it twice would weight it twice
    on every future report.
    """
    clean = " ".join((text or "").split())[:MAX_LEN]
    if len(clean) < 8:
        return None                     # "no", "wrong" — nothing to carry forward
    existing = (db.query(models.CoachPreference)
                  .filter_by(coach_id=coach_id, team_id=team_id, text=clean).first())
    if existing:
        existing.active = True
        return existing
    row = models.CoachPreference(coach_id=coach_id, team_id=team_id,
                                 text=clean, source=source)
    db.add(row)
    # Flushed, not just added: a coach who repeats themselves in the same
    # request would otherwise store it twice, because the lookup above cannot
    # see a row that is still only pending. Two copies is the same instruction
    # weighted twice on every future report.
    db.flush()
    return row


def for_prompt(db: Session, coach_id: int, team_id: int | None) -> str:
    """The block to hand a generation, or "" when this coach has taught nothing.

    Both scopes together: what the coach generally cares about, and what they
    have said about this team. They are not in competition — a coach has a way
    they play and a plan for a particular opponent.
    """
    from sqlalchemy import or_
    q = (db.query(models.CoachPreference)
           .filter(models.CoachPreference.coach_id == coach_id,
                   models.CoachPreference.active.is_(True)))
    if team_id is not None:
        q = q.filter(or_(models.CoachPreference.team_id == team_id,
                         models.CoachPreference.team_id.is_(None)))
    else:
        q = q.filter(models.CoachPreference.team_id.is_(None))
    rows = q.order_by(models.CoachPreference.id.desc()).limit(MAX_APPLIED).all()
    if not rows:
        return ""
    lines = "\n".join(f"  · {r.text}" for r in reversed(rows))
    return (
        "\n\nWHAT THIS COACH HAS ASKED FOR BEFORE:\n"
        "These are corrections they have made to earlier reports. Treat them as "
        "standing instructions about what to look for and what to say — cover "
        "them where the film supports it, and do not claim them where it does "
        "not.\n" + lines
    )


@router.get("", response_model=list[PreferenceOut])
def list_preferences(
    team_id: int | None = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Everything this coach has taught, newest first.

    `team_id` narrows to one team AND the program-wide ones, which is what the
    team's own page wants to show: everything that will actually be applied to
    a report about them.
    """
    from sqlalchemy import or_
    q = db.query(models.CoachPreference).filter(models.CoachPreference.coach_id == coach.id)
    if team_id is not None:
        q = q.filter(or_(models.CoachPreference.team_id == team_id,
                         models.CoachPreference.team_id.is_(None)))
    rows = q.order_by(models.CoachPreference.id.desc()).all()
    out = []
    for r in rows:
        out.append(PreferenceOut(
            id=r.id, team_id=r.team_id,
            team_name=(r.team.name if r.team else None),
            text=r.text, source=r.source or "correction",
            active=r.active is not False,
            created_at=r.created_at.isoformat() if r.created_at else "",
        ))
    return out


@router.patch("/{pref_id}", response_model=PreferenceOut)
def set_preference_active(
    pref_id: int,
    body: PreferenceUpdate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    row = db.get(models.CoachPreference, pref_id)
    if not row or row.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Not found")
    row.active = body.active
    db.commit()
    return PreferenceOut(
        id=row.id, team_id=row.team_id, team_name=(row.team.name if row.team else None),
        text=row.text, source=row.source or "correction", active=row.active is not False,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


@router.delete("/{pref_id}")
def delete_preference(
    pref_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    row = db.get(models.CoachPreference, pref_id)
    if not row or row.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(row)
    db.commit()
    return {"ok": True}
