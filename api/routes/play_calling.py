"""Play calling: record possessions live or after the game, keep the catalogs,
and read the numbers. See api/play_calling.py for the vocabulary and maths."""
from __future__ import annotations

import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
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
    no points stays a score with no points: the numbers never guess them.
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
    events = pc.events_by_call(db, game.id)
    return {"possessions": [{**pc.call_out(c), "events": events.get(c.id, [])} for c in calls],
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
    # Calling the next play ends the one before: nothing scored, it was a stop.
    prev = pc.current_possession(db, game.id)
    if prev is not None and body.source != "import":
        pc.settle_from_stats(db, prev, closing=True)
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
    call, game = _owned_call(db, call_id, coach)
    # A wrong call goes with everything tapped in it: its stats come out of the
    # box score, and while the game is live its baskets come off the score.
    # (A finished game's score is the final one; it is not second-guessed.)
    stats = db.query(models.GamePlayerStat).filter_by(possession_id=call.id).all()
    for st in stats:
        if game.status == "in_progress" and st.stat_name in pc.POINTS:
            pc._add_score(db, game, bool(st.is_opponent), -pc.POINTS[st.stat_name] * (st.count or 1))
        db.query(models.StatDuplicate).filter_by(original_id=st.id).update({"original_id": None})
        db.delete(st)
    db.delete(call)
    db.commit()
    db.refresh(game)
    from .game_eval import _shown_scores
    ours, theirs = _shown_scores(game)
    return {"ok": True, "stats_removed": len(stats), "our_score": ours, "opponent_score": theirs}


class FinishIn(BaseModel):
    result: str                      # score / no_score
    player_name: str | None = None
    player_id: int | None = None
    ended: str | None = None
    ft_made: int | None = None
    ft_att: int | None = None


@router.post("/possessions/{call_id}/finish")
def finish(call_id: int, body: FinishIn, db: Session = Depends(get_db),
           coach: models.Coach = Depends(get_current_coach)):
    """+ or − on a possession, with who and how: the stats it implies are
    linked if already logged, created if not, and the score moves once."""
    call, game = _owned_call(db, call_id, coach)
    if body.result not in ("score", "no_score") or (body.ended and body.ended not in pc.ENDINGS):
        raise HTTPException(status_code=400, detail="result or ending not recognised")
    if body.result == "score" and body.ended in ("miss2", "miss3", "turnover", "ft_miss"):
        raise HTTPException(status_code=400, detail="a score cannot end in a miss")
    for v in (body.ft_made, body.ft_att):
        if v is not None and not 0 <= v <= 3:
            raise HTTPException(status_code=400, detail="free throws out of range")
    pc.finish_possession(db, game, coach, call, result=body.result,
                         player_name=(body.player_name or "").strip() or None, ended=body.ended,
                         ft_made=body.ft_made, ft_att=body.ft_att, player_id=body.player_id)
    db.commit()
    db.refresh(call)
    db.refresh(game)
    from .game_eval import _shown_scores
    ours, theirs = _shown_scores(game)
    return {"possession": pc.call_out(call), "our_score": ours, "opponent_score": theirs}


class OutcomeIn(BaseModel):
    stat_name: str
    player_name: str
    player_id: int | None = None


@router.post("/possessions/{call_id}/outcome")
def outcome(call_id: int, body: OutcomeIn, db: Session = Depends(get_db),
            coach: models.Coach = Depends(get_current_coach)):
    """2 FG Made, 3 FG Missed, FT Made, Turnover... for a player, in a
    possession: a real stat, counted once — one already tapped in Stats for the
    same player in this possession is claimed, not added again."""
    call, game = _owned_call(db, call_id, coach)
    if body.stat_name not in pc.OUTCOMES or not body.player_name.strip():
        raise HTTPException(status_code=400, detail="an outcome and a player are required")
    stat, dup = pc.record_stat(db, game, coach, player_name=body.player_name.strip(),
                               is_opponent=call.side == "opponent", quarter=call.quarter,
                               stat_name=body.stat_name, player_id=body.player_id,
                               source="pc", call=call)
    if body.stat_name == "Turnover":
        # A turnover ends the trip.
        pc.settle_from_stats(db, call, closing=True)
    db.commit()
    db.refresh(call)
    db.refresh(game)
    from .game_eval import _shown_scores
    ours, theirs = _shown_scores(game)
    return {"possession": pc.call_out(call), "merged": dup is not None,
            "our_score": ours, "opponent_score": theirs}


@router.post("/possessions/{call_id}/close")
def close(call_id: int, db: Session = Depends(get_db),
          coach: models.Coach = Depends(get_current_coach)):
    """No score, nothing more to say: close the trip."""
    call, _ = _owned_call(db, call_id, coach)
    pc.settle_from_stats(db, call, closing=True)
    db.commit()
    db.refresh(call)
    return pc.call_out(call)


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


# ── Import after the game ────────────────────────────────────────────────────
# A sheet (photo, PDF, spreadsheet, CSV) is READ into a preview the coach
# corrects, and only then SAVED — with the team whose plays they are, which the
# sheet itself rarely says.

IMPORT_INSTRUCTION = """This is a basketball play-calling sheet. For each possession it records the
play that was called, whether it scored, and the defense it was run against. It may be handwritten,
photographed, a PDF or a spreadsheet, with one column block per quarter.

Transcribe EVERY possession exactly as written, in order, quarter by quarter. Return ONLY JSON:
{"title": "<the heading, e.g. 'Senegal vs. Angola', or null>",
 "teams": ["<each team name written on the sheet>"],
 "possessions": [
   {"quarter": <1-4, 5 for OT, 6 for OT2...>,
    "play": "<the play exactly as written: keep abbreviations and symbols like 'S.T.', 'Tran Drag', 'Δ', '4/', '??'>",
    "result": "+" | "-" | "",
    "points": <number only if points are written, else null>,
    "defense": "<exactly as written, e.g. 'M', '2', '2-3', or '' if blank>",
    "player": "<a name or number if one is written for that row, else ''>"}],
 "orb": [{"team": "<team name as written>", "quarter": <number, or 0 if for the whole game>,
          "count": <number; count tally marks — a crossed group of four is 5>}]}

A mark in the "+" column means the possession scored; a mark in the "-" column means it did not;
neither means leave result "". Never guess a play you cannot read: write "?". Skip crossed-out
entries. Do not add possessions that are not on the sheet."""


class ImportRow(BaseModel):
    quarter: int
    play: str = ""
    result: str = ""                 # + / - / ""
    points: int | None = None
    defense: str = ""
    player: str = ""


class ImportOrb(BaseModel):
    side: str
    quarter: int = 0
    count: int


class ImportSave(BaseModel):
    side: str                         # whose possessions these are
    possessions: list[ImportRow]
    orb: list[ImportOrb] = []
    replace: bool = True              # replace what an earlier import of this side saved


def _side_guess(name: str, game: models.GameSession, our_name: str) -> str | None:
    k = pc.key(name)
    if not k:
        return None
    if k in (pc.key(our_name),) or (pc.key(our_name) and (k in pc.key(our_name) or pc.key(our_name) in k)):
        return "our"
    opp = pc.key(game.opponent_name)
    if k == opp or (opp and (k in opp or opp in k)):
        return "opponent"
    return None


from fastapi import File, UploadFile  # noqa: E402


_HEADINGS = {
    "quarter": {"quarter", "qtr", "q", "period", "per"},
    "play": {"play", "call", "set", "playcall", "offense", "offensiveplay"},
    "result": {"result", "+/-", "+-", "score", "scored", "outcome"},
    "points": {"points", "pts", "point"},
    "defense": {"defense", "def", "d", "defence"},
    "player": {"player", "scorer", "who"},
}


def _read_table(data: bytes, filename: str) -> dict | None:
    """A CSV or Excel sheet with column headings (Quarter, Play, Result,
    Points, Defense, Player), read directly. None when it is not one."""
    import csv
    import io
    name = filename.lower()
    rows: list[list] = []
    try:
        if name.endswith((".xlsx", ".xls")):
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            rows = [list(r) for r in wb.active.iter_rows(values_only=True)]
        elif name.endswith((".csv", ".tsv", ".txt")):
            text = data.decode("utf-8-sig", errors="ignore")
            rows = list(csv.reader(io.StringIO(text), delimiter="\t" if name.endswith(".tsv") else ","))
        else:
            return None
    except Exception:
        return None
    for h, head in enumerate(rows[:5]):
        cols = {}
        for i, cell in enumerate(head):
            k = re.sub(r"[^a-z+/-]", "", str(cell or "").lower())
            for field, names in _HEADINGS.items():
                if k in names and field not in cols:
                    cols[field] = i
        if "play" in cols and ("result" in cols or "points" in cols):
            break
    else:
        return None
    out = []
    for r in rows[h + 1:]:
        def cell(f):
            i = cols.get(f)
            return "" if i is None or i >= len(r) or r[i] is None else str(r[i]).strip()
        play, res, pts = cell("play"), cell("result").lower(), cell("points")
        if not play and not res:
            continue
        q = re.sub(r"[^0-9]", "", cell("quarter")) or "1"
        points = int(float(pts)) if re.fullmatch(r"-?\d+(\.\d+)?", pts or "") else None
        result = ("+" if res in ("+", "y", "yes", "score", "scored", "1", "made") or (points or 0) > 0
                  else "-" if res in ("-", "n", "no", "0", "miss", "missed") or points == 0 else "")
        out.append({"quarter": int(q), "play": play, "result": result, "points": points,
                    "defense": cell("defense"), "player": cell("player")})
    return {"title": None, "teams": [], "possessions": out, "orb": []}


@router.post("/games/{game_id}/import/read")
async def import_read(game_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                      coach: models.Coach = Depends(get_current_coach)):
    """Read a play-calling sheet into a preview. Nothing is saved."""
    from .. import ai_import
    from ..uploadguard import read_upload
    game = _get_game_trackable(db, game_id, coach)
    team = db.get(models.Team, game.team_id) if game.team_id else None
    our_name = (team.name if team else None) or coach.program_name or ""
    data = await read_upload(file, what="document")
    # A spreadsheet with plain column headings is read as it is: exact, and
    # free. Anything else (a photo, a PDF, a sheet laid out by hand) is read
    # by the model.
    got = _read_table(data, file.filename or "")
    if got is None:
        try:
            got = ai_import.ai_extract_json(data, file.filename or "", file.content_type, IMPORT_INSTRUCTION) or {}
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=str(e))
    if not isinstance(got, dict):
        got = {}
    rows = []
    for r in got.get("possessions") or []:
        if not isinstance(r, dict):
            continue
        try:
            q = int(r.get("quarter") or 1)
        except (TypeError, ValueError):
            q = 1
        res = str(r.get("result") or "").strip()
        res = "+" if res in ("+", "plus", "score", "scored", "1", "yes") else "-" if res in ("-", "−", "minus", "no", "0") else ""
        pts = r.get("points")
        rows.append({"quarter": max(1, min(q, 20)), "play": str(r.get("play") or "").strip()[:60],
                     "result": res, "points": int(pts) if isinstance(pts, (int, float)) else None,
                     "defense": str(r.get("defense") or "").strip()[:40],
                     "player": str(r.get("player") or "").strip()[:80]})
    orb = []
    for o in got.get("orb") or []:
        if isinstance(o, dict) and isinstance(o.get("count"), (int, float)):
            orb.append({"team": str(o.get("team") or ""), "quarter": int(o.get("quarter") or 0),
                        "count": int(o["count"]),
                        "side": _side_guess(str(o.get("team") or ""), game, our_name)})
    teams = [str(x) for x in (got.get("teams") or []) if str(x).strip()]
    return {"title": got.get("title"), "teams": teams, "possessions": rows, "orb": orb,
            "sides": {"our": our_name, "opponent": game.opponent_name}}


@router.post("/games/{game_id}/import/save")
def import_save(game_id: int, body: ImportSave, db: Session = Depends(get_db),
                coach: models.Coach = Depends(get_current_coach)):
    """Save a corrected preview as the game's possessions for one side."""
    game = _get_game_trackable(db, game_id, coach)
    if body.side not in ("our", "opponent"):
        raise HTTPException(status_code=400, detail="Say whose plays these are.")
    if body.replace:
        old = db.query(models.PlayCall).filter_by(game_id=game.id, side=body.side, source="import").all()
        for c in old:
            db.query(models.GamePlayerStat).filter_by(possession_id=c.id).update({"possession_id": None})
            db.delete(c)
        db.flush()
    seq = db.query(func.max(models.PlayCall.seq)).filter_by(game_id=game.id).scalar() or 0
    saved = 0
    for r in body.possessions:
        if not r.play.strip() and not r.result:
            continue
        seq += 1
        name, typ = pc.resolve_play(db, game, body.side, r.play or "?")
        db.flush()
        call = models.PlayCall(
            game_id=game.id, side=body.side, quarter=max(1, min(r.quarter, 20)), seq=seq,
            play=name, play_type=typ, defense=pc.resolve_defense(db, game.coach_id, r.defense),
            result="score" if r.result == "+" else "no_score" if r.result == "-" else None,
            points=(r.points if r.result == "+" else 0 if r.result == "-" else None),
            player_name=r.player.strip() or None, source="import", logged_by=coach.id)
        db.flush()
        db.add(call)
        saved += 1
    for o in body.orb:
        if o.side not in ("our", "opponent") or not 0 <= o.quarter <= 20 or o.count < 0:
            continue
        row = db.query(models.GameTally).filter_by(game_id=game.id, side=o.side, quarter=o.quarter, stat="orb").first()
        if row is None:
            db.add(models.GameTally(game_id=game.id, side=o.side, quarter=o.quarter, stat="orb", count=o.count))
        else:
            row.count = o.count
    db.commit()
    return {"saved": saved}


# ── The Play Calling tab: which games have it, and the report ───────────────

@router.get("/overview")
def overview(db: Session = Depends(get_db), coach: models.Coach = Depends(get_current_coach)):
    """For each game this coach can see: how much play calling it has, and
    whether they have a report — what a game card says."""
    from .game_eval import _accessible_team_ids
    teams = _accessible_team_ids(db, coach)
    q = db.query(models.PlayCall.game_id, models.PlayCall.side, models.PlayCall.result,
                 func.count(models.PlayCall.id)) \
        .join(models.GameSession, models.GameSession.id == models.PlayCall.game_id)
    from sqlalchemy import or_
    mine = [models.GameSession.coach_id == coach.id]
    if teams:
        mine.append(models.GameSession.team_id.in_(teams))
    q = q.filter(or_(*mine))
    out: dict = {}
    for gid, side, result, n in q.group_by(models.PlayCall.game_id, models.PlayCall.side,
                                           models.PlayCall.result).all():
        g = out.setdefault(str(gid), {"our": {"n": 0, "scored": 0}, "opponent": {"n": 0, "scored": 0}, "report": False})
        if result in ("score", "no_score"):
            g[side]["n"] += n
            if result == "score":
                g[side]["scored"] += n
    for r in db.query(models.PlayCallingReport.game_id).filter(
            models.PlayCallingReport.coach_id == coach.id,
            models.PlayCallingReport.report_text.isnot(None)).all():
        out.setdefault(str(r.game_id), {"our": {"n": 0, "scored": 0}, "opponent": {"n": 0, "scored": 0}})["report"] = True
    return out


@router.get("/games/{game_id}/report")
def get_report(game_id: int, db: Session = Depends(get_db), coach: models.Coach = Depends(get_current_coach)):
    game = _get_game_readable(db, game_id, coach)
    r = db.query(models.PlayCallingReport).filter_by(game_id=game.id, coach_id=coach.id).first()
    return {"report_text": r.report_text if r else None, "context": r.context if r else None,
            "updated_at": r.updated_at.isoformat() + "Z" if r and r.updated_at else None}


class ReportIn(BaseModel):
    context: str | None = None


@router.post("/games/{game_id}/report-job")
def start_report(game_id: int, body: ReportIn, background_tasks: BackgroundTasks,
                 db: Session = Depends(get_db), coach: models.Coach = Depends(get_current_coach)):
    """Write (or rewrite) the Play Calling Efficiency report; a job to follow."""
    from .. import genjob
    game = _get_game_readable(db, game_id, coach)
    if not db.query(models.PlayCall).filter_by(game_id=game.id).first():
        raise HTTPException(status_code=400, detail="This game has no play calling recorded yet.")
    r = db.query(models.PlayCallingReport).filter_by(game_id=game.id, coach_id=coach.id).first()
    if r is None:
        r = models.PlayCallingReport(game_id=game.id, coach_id=coach.id)
        db.add(r)
    if body.context is not None:
        r.context = body.context.strip()[:4000] or None
    db.commit()
    job = genjob.start(db, coach.id, "play_calling_report", {"game_id": game.id, "coach_id": coach.id})
    background_tasks.add_task(_run_report_job, game.id, coach.id, job.id)
    return {"job_id": job.id}


def report_prompt(db: Session, game: models.GameSession, coach: models.Coach) -> str:
    """The Play Calling Efficiency report's prompt: the play calling, read
    against everything else known about the game."""
    from ..coach_context import resolve_level, language_directive
    from ..report_format import REPORT_FORMAT_WITH_TABLES
    from .game_eval import box_score_text, film_notes_for_game, _team_notes_text
    team = db.get(models.Team, game.team_id) if game.team_id else None
    ours = (team.name if team else None) or coach.program_name or "Our team"
    sides = {"our": ours, "opponent": game.opponent_name or "Opponent"}
    score = ""
    if game.our_score is not None and game.opponent_score is not None:
        score = f"Final score: {ours} {game.our_score} – {game.opponent_score} {sides['opponent']}\n"
    r = db.query(models.PlayCallingReport).filter_by(game_id=game.id, coach_id=coach.id).first()
    ctx = f"\n\nCOACH CONTEXT (weave this in):\n{r.context}" if r and r.context else ""
    level = resolve_level(coach, team=team)
    return (
        f"You are the BloomPrint Basketball Intelligence Model. Write a PLAY CALLING EFFICIENCY REPORT "
        f"for {ours} vs {sides['opponent']}.\nCOMPETITION LEVEL: {level}\n{score}\n"
        f"{pc.prompt_block(db, game, sides)}\n\n"
        f"BOX SCORE:\n{box_score_text(db, game)}"
        f"{film_notes_for_game(db, coach, game)}{_team_notes_text(db, coach, game)}{ctx}\n\n"
        "Cover, in this order:\n"
        "1) SUMMARY — how efficient the play calling was for each team that has possessions recorded, "
        "and the one thing that decided it.\n"
        "2) WHAT WORKED AND WHAT DID NOT — by play and by play type (half court vs transition, "
        "ATOs), with the counts.\n"
        "3) AGAINST EACH DEFENSE — which plays scored against which defense, and which did not.\n"
        "4) QUARTER BY QUARTER — how it changed through the game and why, from the possessions.\n"
        "5) WHO FINISHED — which players scored or missed out of which plays, where recorded.\n"
        "6) RECOMMENDATIONS — plays to keep calling, plays to change or drop, what to call against "
        "each defense next time; and, for the opponent's possessions, what to take away.\n"
        "Rules: quote the recorded counts. Never state, estimate or imply points where the data does "
        "not give them — use scored / not scored. Treat plays named 'Unknown' as unidentified. Do not "
        "invent plays, players or possessions."
        f"{REPORT_FORMAT_WITH_TABLES}{language_directive(coach)}"
    )


def _run_report_job(game_id: int, coach_id: int, job_id: int) -> None:
    import asyncio
    from .. import genjob
    from ..ai_models import long_text
    from ..database import SessionLocal

    def work():
        db = SessionLocal()
        try:
            game = db.get(models.GameSession, game_id)
            coach = db.get(models.Coach, coach_id)
            if not game or not coach:
                raise RuntimeError("Game not found")
            prompt = report_prompt(db, game, coach)
            text = asyncio.run(long_text(prompt, max_tokens=12000, on_words=genjob.words_reporter(job_id)))
            if not (text or "").strip():
                raise RuntimeError("The report came back empty.")
            r = db.query(models.PlayCallingReport).filter_by(game_id=game_id, coach_id=coach_id).first()
            if r is None:
                r = models.PlayCallingReport(game_id=game_id, coach_id=coach_id)
                db.add(r)
            r.report_text = text.strip()
            db.commit()
        finally:
            db.close()
        return game_id

    genjob.run(job_id, work)
