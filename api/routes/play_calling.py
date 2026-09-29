"""Play calling: record possessions live or after the game, keep the catalogs,
and read the numbers. See api/play_calling.py for the vocabulary and maths."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, play_calling as pc
from ..auth import get_current_coach
from ..database import get_db
from .game_eval import _get_game_readable, _get_game_trackable

router = APIRouter(prefix="/play-calling", tags=["play-calling"])


class PossessionIn(BaseModel):
    side: str | None = None                # our / opponent
    quarter: int | None = None
    play: str | None = None
    play_type: str | None = None
    defense: str | None = None
    result: str | None = None              # score / no_score / "" to reopen
    points: int | None = None
    ended: str | None = None
    ft_made: int | None = None
    ft_att: int | None = None
    player_name: str | None = None
    source: str | None = None


def _settle(call: models.PlayCall) -> None:
    """Make result, points and how it ended agree.

    An ending says both whether it scored and — except free throws, which say
    how many went in — how many points. Points given outright win; a score with
    no points stays a score whose points are estimated in the numbers.
    """
    if call.ended == "ft" and call.ft_made is not None:
        call.points = call.ft_made if call.points is None else call.points
    elif call.ended in pc.ENDINGS and pc.ENDINGS[call.ended] is not None and call.points is None:
        call.points = pc.ENDINGS[call.ended]
    if call.points is not None and call.result is None:
        call.result = "score" if call.points > 0 else "no_score"
    if call.result == "no_score":
        call.points = 0


def _apply(db: Session, game: models.GameSession, call: models.PlayCall, body: PossessionIn) -> None:
    data = body.model_dump(exclude_unset=True)
    if "side" in data:
        if data["side"] not in ("our", "opponent"):
            raise HTTPException(status_code=400, detail="side must be our or opponent")
        call.side = data["side"]
    if "quarter" in data and data["quarter"] is not None:
        if not 1 <= data["quarter"] <= 20:
            raise HTTPException(status_code=400, detail="quarter out of range")
        call.quarter = data["quarter"]
    if "play" in data or "play_type" in data:
        if data.get("play_type") and data["play_type"] not in pc.PLAY_TYPES:
            raise HTTPException(status_code=400, detail="unknown play type")
        call.play, call.play_type = pc.resolve_play(db, game, call.side, data.get("play", call.play),
                                                    data.get("play_type"))
    if "defense" in data:
        call.defense = pc.resolve_defense(db, game.coach_id, data["defense"])
    if "result" in data:
        if data["result"] not in (None, "", "score", "no_score"):
            raise HTTPException(status_code=400, detail="result must be score or no_score")
        call.result = data["result"] or None
        if not call.result:
            call.points = call.ended = call.ft_made = call.ft_att = None
    if "ended" in data:
        if data["ended"] not in (None, "", *pc.ENDINGS):
            raise HTTPException(status_code=400, detail="unknown ending")
        call.ended = data["ended"] or None
    for f in ("points", "ft_made", "ft_att"):
        if f in data:
            v = data[f]
            if v is not None and not 0 <= v <= 10:
                raise HTTPException(status_code=400, detail=f"{f} out of range")
            setattr(call, f, v)
    if "player_name" in data:
        call.player_name = (data["player_name"] or "").strip()[:80] or None
    if "source" in data and data["source"] in ("live", "import"):
        call.source = data["source"]
    _settle(call)


@router.get("/games/{game_id}")
def game_play_calling(game_id: int, db: Session = Depends(get_db),
                      coach: models.Coach = Depends(get_current_coach)):
    """A game's possessions in order, the numbers, the ORB tallies, the catalog."""
    game = _get_game_readable(db, game_id, coach)
    calls = (db.query(models.PlayCall).filter_by(game_id=game.id)
             .order_by(models.PlayCall.seq, models.PlayCall.id).all())
    return {"possessions": [pc.call_out(c) for c in calls],
            "summary": pc.summary(calls, game),
            "orb": pc.tallies(db, game.id),
            "catalog": pc.catalog_for_game(db, game)}


@router.get("/games/{game_id}/catalog")
def game_catalog(game_id: int, db: Session = Depends(get_db),
                 coach: models.Coach = Depends(get_current_coach)):
    return pc.catalog_for_game(db, _get_game_readable(db, game_id, coach))


@router.post("/games/{game_id}/possessions")
def add_possession(game_id: int, body: PossessionIn, db: Session = Depends(get_db),
                   coach: models.Coach = Depends(get_current_coach)):
    game = _get_game_trackable(db, game_id, coach)
    if body.side not in ("our", "opponent") or not body.quarter:
        raise HTTPException(status_code=400, detail="side and quarter are required")
    last = db.query(func.max(models.PlayCall.seq)).filter_by(game_id=game.id).scalar() or 0
    call = models.PlayCall(game_id=game.id, side=body.side, quarter=body.quarter, seq=last + 1,
                           play="Unknown", play_type="unknown", logged_by=coach.id)
    if body.play is None:
        body.play = "Unknown"
    _apply(db, game, call, body)
    db.add(call)
    db.commit()
    db.refresh(call)
    return pc.call_out(call)


def _owned_call(db: Session, call_id: int, coach: models.Coach) -> tuple[models.PlayCall, models.GameSession]:
    call = db.get(models.PlayCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Possession not found")
    return call, _get_game_trackable(db, call.game_id, coach)


@router.patch("/possessions/{call_id}")
def edit_possession(call_id: int, body: PossessionIn, db: Session = Depends(get_db),
                    coach: models.Coach = Depends(get_current_coach)):
    call, game = _owned_call(db, call_id, coach)
    _apply(db, game, call, body)
    db.commit()
    db.refresh(call)
    return pc.call_out(call)


@router.delete("/possessions/{call_id}")
def delete_possession(call_id: int, db: Session = Depends(get_db),
                      coach: models.Coach = Depends(get_current_coach)):
    call, _ = _owned_call(db, call_id, coach)
    # Stats that happened in it stay; they just belong to no possession now.
    db.query(models.GamePlayerStat).filter_by(possession_id=call.id).update({"possession_id": None})
    db.delete(call)
    db.commit()
    return {"ok": True}


class TallyIn(BaseModel):
    side: str
    quarter: int
    delta: int = 1


@router.post("/games/{game_id}/orb")
def change_orb(game_id: int, body: TallyIn, db: Session = Depends(get_db),
               coach: models.Coach = Depends(get_current_coach)):
    """Add (or take back) an offensive rebound for a side in a quarter."""
    from sqlalchemy.exc import IntegrityError
    game = _get_game_trackable(db, game_id, coach)
    if body.side not in ("our", "opponent") or not 0 <= body.quarter <= 20 or not -5 <= body.delta <= 20:
        raise HTTPException(status_code=400, detail="side, quarter or delta out of range")
    row = db.query(models.GameTally).filter_by(game_id=game.id, side=body.side,
                                               quarter=body.quarter, stat="orb").first()
    if row is None:
        db.add(models.GameTally(game_id=game.id, side=body.side, quarter=body.quarter,
                                stat="orb", count=max(0, body.delta)))
        try:
            db.commit()
        except IntegrityError:        # another tracker made the row first
            db.rollback()
            row = db.query(models.GameTally).filter_by(game_id=game.id, side=body.side,
                                                       quarter=body.quarter, stat="orb").first()
    if row is not None:
        # One UPDATE, so two trackers tapping at once both count.
        db.query(models.GameTally).filter_by(id=row.id).update(
            {"count": func.max(0, models.GameTally.count + body.delta)
             if db.bind.dialect.name == "sqlite" else func.greatest(0, models.GameTally.count + body.delta)},
            synchronize_session=False)
        db.commit()
    return pc.tallies(db, game.id)


class CatalogIn(BaseModel):
    side: str
    name: str
    play_type: str | None = None
    aliases: list[str] | None = None


@router.post("/games/{game_id}/catalog")
def add_catalog_play(game_id: int, body: CatalogIn, db: Session = Depends(get_db),
                     coach: models.Coach = Depends(get_current_coach)):
    """Name a play ahead of time (or give one a short form or a type)."""
    game = _get_game_trackable(db, game_id, coach)
    if body.side not in ("our", "opponent") or not body.name.strip():
        raise HTTPException(status_code=400, detail="side and name are required")
    if body.play_type and body.play_type not in pc.PLAY_TYPES:
        raise HTTPException(status_code=400, detail="unknown play type")
    name, typ = pc.resolve_play(db, game, body.side, body.name, body.play_type)
    db.flush()
    entry = next((e for e in pc.play_catalog(db, game, body.side) if pc.key(e.name) == pc.key(name)), None)
    if entry is not None:
        if body.play_type:
            entry.play_type = body.play_type
        if body.aliases:
            entry.aliases = sorted({*(entry.aliases or []), *(a.strip() for a in body.aliases if a.strip())})
    db.commit()
    return pc.catalog_for_game(db, game)
