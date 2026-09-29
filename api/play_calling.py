"""Play calling: what was called, against what, and whether it scored.

A possession is a PlayCall row (models.py). This module owns the vocabulary —
play types, the standard plays and defenses, the short forms a sheet uses —
the catalogs that grow as names are used, and the numbers every screen and
report reads: how often each play scores, and how many points it is worth a
trip, by play, by type, by defense, by play against each defense, by quarter.
"""
from __future__ import annotations

import re
from collections import defaultdict

from sqlalchemy.orm import Session

from . import models

PLAY_TYPES = ["half_court", "transition", "semi_transition", "transition_drag", "ato", "oob",
              "press_break", "unknown"]

# (name, type, short forms). The short forms are what a coach writes on a
# sheet; they resolve to the name. Deliberately few — a team's own plays are
# added the first time they are used.
STANDARD_PLAYS: list[tuple[str, str, list[str]]] = [
    ("Transition", "transition", ["tran", "trans", "fast break", "fb"]),
    ("Semi-transition", "semi_transition", ["s.t.", "st", "semi", "semi tran", "semi-tran"]),
    ("Transition Drag", "transition_drag", ["tran drag", "trans drag"]),
    ("ATO", "ato", ["a.t.o.", "after timeout", "a.t."]),
    ("Out of bounds", "oob", ["slob", "blob", "oob", "inbound"]),
    ("Press break", "press_break", ["press", "pb"]),
    ("Unknown", "unknown", ["??", "?", "? ?", "unknown", "-", "—"]),
]

STANDARD_DEFENSES: list[tuple[str, list[str]]] = [
    ("Man", ["m", "man", "m2m", "man to man", "man-to-man"]),
    ("2-3", ["2", "2-3", "23", "2 3"]),
    ("3-2", ["3-2", "32", "3 2"]),
    ("1-3-1", ["1-3-1", "131"]),
    ("1-2-2", ["1-2-2", "122"]),
    ("Match-up", ["match up", "matchup", "match-up"]),
    ("Zone", ["z", "zone"]),
    ("Press", ["press", "fc press", "full court"]),
    ("Box-and-1", ["box and 1", "box-and-1", "box 1"]),
    ("Triangle-and-2", ["triangle and 2", "triangle-and-2", "t2"]),
]

# How a possession ended, and the points it carries when that is all we know.
ENDINGS = {"made2": 2, "made3": 3, "and1_2": 3, "and1_3": 4, "ft": None, "miss2": 0, "miss3": 0,
           "turnover": 0, "ft_miss": 0, "other": None}


def key(name: str | None) -> str:
    """How two spellings of one name are compared: "S.T." = "st" = "s t".

    Only spacing and punctuation that is just punctuation go; anything else —
    "Δ", "4/", "2-3" — is part of the name. A sheet's symbols are names too.
    """
    return re.sub(r"[\s.,;:'\"()_]+", "", (name or "").lower())


def _type_for(name: str) -> str:
    k = key(name)
    if "drag" in k and ("tran" in k or "trans" in k):
        return "transition_drag"
    if k.startswith("semi") or k == "st":
        return "semi_transition"
    if k.startswith("tran") or k in ("fb", "fastbreak"):
        return "transition"
    return "half_court"


# ── Catalogs ─────────────────────────────────────────────────────────────────

def _side_scope(db: Session, game: models.GameSession, side: str) -> dict:
    """Whose catalog a side's plays go in: our team's, or the opponent's."""
    if side == "our" and game.team_id:
        return {"team_id": game.team_id}
    return {"coach_id": game.coach_id, "opponent": game.opponent_name}


def play_catalog(db: Session, game: models.GameSession, side: str) -> list[models.PlayCatalogEntry]:
    scope = _side_scope(db, game, side)
    q = db.query(models.PlayCatalogEntry)
    if "team_id" in scope:
        q = q.filter(models.PlayCatalogEntry.team_id == scope["team_id"])
    else:
        rows = q.filter(models.PlayCatalogEntry.coach_id == scope["coach_id"],
                        models.PlayCatalogEntry.team_id.is_(None)).all()
        return sorted([r for r in rows if key(r.opponent) == key(scope["opponent"])],
                      key=lambda r: -(r.uses or 0))
    return q.order_by(models.PlayCatalogEntry.uses.desc()).all()


def resolve_play(db: Session, game: models.GameSession, side: str, raw: str,
                 play_type: str | None = None, remember: bool = True) -> tuple[str, str]:
    """(name, type) for what was written: a standard play, one in this side's
    catalog (by name or short form), or a new one — added to the catalog."""
    k = key(raw)
    # "??", "?", "?? Bad": the sheet's way of saying nobody knew what it was.
    if not k or k.startswith("?"):
        return "Unknown", "unknown"
    for name, typ, aliases in STANDARD_PLAYS:
        if k == key(name) or k in {key(a) for a in aliases}:
            return name, play_type or typ
    for entry in play_catalog(db, game, side):
        if k == key(entry.name) or k in {key(a) for a in (entry.aliases or [])}:
            if remember:
                entry.uses = (entry.uses or 0) + 1
            return entry.name, play_type or entry.play_type
    name = " ".join(str(raw).split())[:60]
    typ = play_type if play_type in PLAY_TYPES else _type_for(name)
    if remember:
        db.add(models.PlayCatalogEntry(name=name, play_type=typ, uses=1, **_side_scope(db, game, side)))
    return name, typ


def resolve_defense(db: Session, coach_id: int, raw: str | None, remember: bool = True) -> str | None:
    """A standard defense, one this coach named before, or a new one (added)."""
    k = key(raw)
    if not k:
        return None
    for name, aliases in STANDARD_DEFENSES:
        if k == key(name) or k in {key(a) for a in aliases}:
            return name
    for entry in db.query(models.DefenseCatalogEntry).filter_by(coach_id=coach_id).all():
        if k == key(entry.name):
            if remember:
                entry.uses = (entry.uses or 0) + 1
            return entry.name
    name = " ".join(str(raw).split())[:40]
    if remember:
        db.add(models.DefenseCatalogEntry(coach_id=coach_id, name=name, uses=1))
    return name


def catalog_for_game(db: Session, game: models.GameSession) -> dict:
    """Everything the tracker offers: both sides' plays (most used first, then
    the standard ones), defenses, and play types."""
    def plays(side):
        own = [{"name": e.name, "type": e.play_type, "uses": e.uses or 0} for e in play_catalog(db, game, side)]
        seen = {key(p["name"]) for p in own}
        return own + [{"name": n, "type": t, "uses": 0} for n, t, _ in STANDARD_PLAYS if key(n) not in seen]
    custom = db.query(models.DefenseCatalogEntry).filter_by(coach_id=game.coach_id) \
        .order_by(models.DefenseCatalogEntry.uses.desc()).all()
    return {"our": plays("our"), "opponent": plays("opponent"),
            "defenses": [n for n, _ in STANDARD_DEFENSES] + [d.name for d in custom
                                                             if key(d.name) not in {key(n) for n, _ in STANDARD_DEFENSES}],
            "types": PLAY_TYPES}


# ── The numbers ──────────────────────────────────────────────────────────────

def _estimated_points(calls: list, game: models.GameSession | None, side: str) -> float:
    """What a score whose points were not written down is worth: the average
    of the scores whose points were, else the team's real points per score in
    this game, else 2."""
    known = [c.points for c in calls if c.result == "score" and c.points is not None]
    if known:
        return sum(known) / len(known)
    scores = sum(1 for c in calls if c.result == "score")
    if game is not None and scores:
        pts = game.our_score if side == "our" else game.opponent_score
        if pts:
            return pts / scores
    return 2.0


def _line(calls: list, est: float) -> dict:
    n = len(calls)
    scored = sum(1 for c in calls if c.result == "score")
    known = sum(c.points for c in calls if c.points is not None)
    estimated = sum(est for c in calls if c.result == "score" and c.points is None)
    points = known + estimated
    return {"n": n, "scored": scored, "pct": round(100 * scored / n) if n else 0,
            "points": round(points, 1), "ppp": round(points / n, 2) if n else 0.0,
            "points_estimated": estimated > 0}


def summary(calls: list, game: models.GameSession | None = None) -> dict:
    """The efficiency numbers for one or more games' possessions, per side.

    Only finished possessions (a result) count. Every line has how many trips,
    how many scored, the rate, points and points per possession — the last
    flagged when some scores had no points written down and were estimated.
    """
    out = {}
    for side in ("our", "opponent"):
        mine = [c for c in calls if c.side == side and c.result in ("score", "no_score")]
        if not mine:
            continue
        est = _estimated_points(mine, game, side)

        def by(fn):
            groups = defaultdict(list)
            for c in mine:
                groups[fn(c)].append(c)
            rows = [{"key": k, **_line(v, est)} for k, v in groups.items()]
            return sorted(rows, key=lambda r: (-r["n"], str(r["key"])))
        ends = defaultdict(int)
        for c in mine:
            if c.result == "no_score" and c.ended:
                ends[c.ended] += 1
        out[side] = {
            "overall": _line(mine, est),
            "by_play": by(lambda c: c.play),
            "by_type": by(lambda c: c.play_type),
            "by_defense": by(lambda c: c.defense or "Not noted"),
            "by_play_defense": by(lambda c: f"{c.play} vs {c.defense or 'not noted'}"),
            "by_quarter": sorted(by(lambda c: c.quarter), key=lambda r: r["key"]),
            "no_score_endings": dict(ends),
        }
    return out


def tallies(db: Session, game_id: int) -> dict:
    """Offensive rebounds by side and quarter (quarter 0: whole game, from a sheet)."""
    out: dict = {"our": {}, "opponent": {}}
    for t in db.query(models.GameTally).filter_by(game_id=game_id, stat="orb").all():
        out.setdefault(t.side, {})[t.quarter] = t.count
    return out


def call_out(c: models.PlayCall) -> dict:
    return {"id": c.id, "side": c.side, "quarter": c.quarter, "seq": c.seq, "play": c.play,
            "play_type": c.play_type, "defense": c.defense, "result": c.result, "points": c.points,
            "ended": c.ended, "ft_made": c.ft_made, "ft_att": c.ft_att, "player_name": c.player_name,
            "source": c.source, "logged_by": c.logged_by}


# ── Live: stats, possessions and the score, counted once ─────────────────────
# A basket is one GamePlayerStat. The score, the player's grade and the
# play-calling result all read that one row. Two things would count it twice:
# two trackers logging the same basket, and one tracker logging it in Stats and
# again in Play Calling. The first is merged here (DUPLICATE_SECONDS); the
# second never creates a row — Play Calling links to the stat already there.

DUPLICATE_SECONDS = 10
POINTS = {"2 FG Made": 2, "3 FG Made": 3, "FT Made": 1}
MISS_ENDING = {"2 FG Missed": "miss2", "3 FG Missed": "miss3", "Turnover": "turnover", "FT Missed": "ft_miss"}
ENDING_STATS = {
    "made2": ["2 FG Made"], "made3": ["3 FG Made"], "and1_2": ["2 FG Made", "FT Made"],
    "and1_3": ["3 FG Made", "FT Made"], "miss2": ["2 FG Missed"], "miss3": ["3 FG Missed"],
    "turnover": ["Turnover"],
}


def current_possession(db: Session, game_id: int) -> models.PlayCall | None:
    """The possession being played: the latest one, until the next is called."""
    return (db.query(models.PlayCall).filter_by(game_id=game_id)
            .order_by(models.PlayCall.seq.desc(), models.PlayCall.id.desc()).first())


def settle_from_stats(db: Session, call: models.PlayCall, closing: bool = False,
                      taken_back: bool = False) -> None:
    """A live possession's result, from the stats that happened in it.

    Points are the offense's made shots and free throws. Scored: how it ended
    follows from what went in (an FG and a free throw is an and-1). Nothing
    scored: left open while the trip goes on (a miss can be rebounded), and
    closed as no score — ended by its last miss or turnover — when the next
    possession is called.
    """
    offense_is_opp = call.side == "opponent"
    linked = (db.query(models.GamePlayerStat)
              .filter_by(possession_id=call.id, is_opponent=offense_is_opp)
              .order_by(models.GamePlayerStat.id).all())
    pts = sum(POINTS.get(s.stat_name, 0) * (s.count or 1) for s in linked)
    fg = [s for s in linked if s.stat_name in ("2 FG Made", "3 FG Made")]
    fts = [s for s in linked if s.stat_name in ("FT Made", "FT Missed")]
    ft_made = sum(s.count or 1 for s in fts if s.stat_name == "FT Made")
    if pts > 0:
        call.result, call.points = "score", pts
        scorer = (fg[-1] if fg else next((s for s in fts if s.stat_name == "FT Made"), None))
        call.player_name = scorer.player_name if scorer else call.player_name
        if fg and ft_made:
            call.ended = "and1_3" if fg[-1].stat_name == "3 FG Made" else "and1_2"
        elif fg:
            call.ended = "made3" if fg[-1].stat_name == "3 FG Made" else "made2"
        else:
            call.ended = "ft"
        call.ft_made = ft_made if fts else None
        call.ft_att = sum(s.count or 1 for s in fts) if fts else None
        return
    if call.result == "score" and (linked or taken_back):
        # The basket it scored with was taken back: open again.
        call.result = call.points = call.ended = call.ft_made = call.ft_att = call.player_name = None
    if closing and call.result is None:
        call.result, call.points = "no_score", 0
        last = next((s for s in reversed(linked) if s.stat_name in MISS_ENDING), None)
        if last:
            call.ended, call.player_name = MISS_ENDING[last.stat_name], last.player_name
            if last.stat_name == "FT Missed":
                call.ft_made, call.ft_att = 0, sum(s.count or 1 for s in fts)


def _add_score(db: Session, game: models.GameSession, is_opponent: bool, delta: int) -> None:
    """Change one side's score in one UPDATE (see game_eval.change_score)."""
    from sqlalchemy import case, update, func as f
    from .routes.game_eval import effective_scores
    col = models.GameSession.opponent_score if is_opponent else models.GameSession.our_score
    ours, theirs = effective_scores(game)
    base = (theirs if is_opponent else ours) or 0
    new = f.coalesce(col, base) + delta
    db.execute(update(models.GameSession).where(models.GameSession.id == game.id)
               .values({col.key: case((new < 0, 0), else_=new)}))


def record_stat(db: Session, game: models.GameSession, coach, *, player_name: str, is_opponent: bool,
                quarter: int, stat_name: str, count: int = 1, player_id: int | None = None,
                apply_score: bool = True, raw_points: float | None = None,
                force: bool = False) -> tuple[models.GamePlayerStat | None, models.StatDuplicate | None]:
    """Log one stat live, once.

    Merged instead of counted when someone ELSE logged the same stat for the
    same player in the last few seconds (unless `force`: "Count it"). Otherwise
    stored, attached to the possession being played, the score moved for a
    made shot, and the possession's result brought up to date.
    """
    from datetime import datetime, timedelta
    from .routes.game_eval import _import_raw, _quarter_multiplier, stat_category
    now = datetime.utcnow()
    if not force:
        twin = (db.query(models.GamePlayerStat)
                .filter(models.GamePlayerStat.game_id == game.id,
                        models.GamePlayerStat.is_opponent == is_opponent,
                        models.GamePlayerStat.player_name == player_name,
                        models.GamePlayerStat.stat_name == stat_name,
                        models.GamePlayerStat.logged_by.isnot(None),
                        models.GamePlayerStat.logged_by != coach.id,
                        models.GamePlayerStat.created_at >= now - timedelta(seconds=DUPLICATE_SECONDS))
                .order_by(models.GamePlayerStat.id.desc()).first())
        if twin is not None:
            dup = models.StatDuplicate(game_id=game.id, original_id=twin.id, logged_by=coach.id,
                                       payload={"player_name": player_name, "is_opponent": is_opponent,
                                                "quarter": quarter, "stat_name": stat_name, "count": count,
                                                "player_id": player_id})
            db.add(dup)
            return None, dup
    raw = _import_raw(stat_name, count) if raw_points is None else raw_points
    mult = _quarter_multiplier(quarter)
    call = current_possession(db, game.id)
    stat = models.GamePlayerStat(
        game_id=game.id, player_id=player_id, player_name=player_name, is_opponent=is_opponent,
        quarter=quarter, stat_name=stat_name, stat_category=stat_category(stat_name),
        raw_points=raw, quarter_multiplier=mult, weighted_points=raw * mult, count=count,
        logged_by=coach.id, possession_id=call.id if call is not None else None, created_at=now)
    db.add(stat)
    db.flush()
    if apply_score and stat_name in POINTS:
        _add_score(db, game, is_opponent, POINTS[stat_name] * count)
    if call is not None:
        settle_from_stats(db, call)
    return stat, None


def finish_possession(db: Session, game: models.GameSession, coach, call: models.PlayCall, *,
                      result: str, player_name: str | None, ended: str | None,
                      ft_made: int | None, ft_att: int | None, player_id: int | None = None) -> None:
    """+ or − in Play Calling, with who and how.

    The stats it implies are LINKED if already logged for that player in this
    possession (or just before it was called), and created only if not — so
    logging the basket in Stats and then pressing + counts it once.
    """
    from datetime import datetime, timedelta
    offense_is_opp = call.side == "opponent"
    wanted: list[str] = list(ENDING_STATS.get(ended or "", []))
    if ended == "ft":
        att = ft_att or 2
        made = min(ft_made if ft_made is not None else att, att)
        wanted = ["FT Made"] * made + ["FT Missed"] * (att - made)
    elif ended == "ft_miss":
        wanted = ["FT Missed"] * (ft_att or 2)
    if player_name:
        recent = datetime.utcnow() - timedelta(seconds=60)
        pool = (db.query(models.GamePlayerStat)
                .filter(models.GamePlayerStat.game_id == game.id,
                        models.GamePlayerStat.is_opponent == offense_is_opp,
                        models.GamePlayerStat.player_name == player_name,
                        ((models.GamePlayerStat.possession_id == call.id)
                         | ((models.GamePlayerStat.possession_id.is_(None))
                            & (models.GamePlayerStat.created_at >= recent))))
                .order_by(models.GamePlayerStat.id).all())
        used: set[int] = set()
        for name in wanted:
            match = next((s for s in pool if s.stat_name == name and s.id not in used), None)
            if match is not None:
                used.add(match.id)
                match.possession_id = call.id
                continue
            stat, _ = record_stat(db, game, coach, player_name=player_name, is_opponent=offense_is_opp,
                                  quarter=call.quarter, stat_name=name, player_id=player_id, force=True)
            if stat is not None:
                stat.possession_id = call.id
                used.add(stat.id)
        db.flush()
    call.ended = ended or call.ended
    if player_name:
        call.player_name = player_name
    settle_from_stats(db, call)
    if result == "no_score":
        call.result, call.points = "no_score", 0
        if ended == "ft_miss":
            call.ft_made, call.ft_att = 0, ft_att or 2
    elif call.result != "score":
        # Scored with no player or no shot given: a score whose points are
        # estimated, the same as a sheet's bare "+".
        call.result, call.points = "score", None


def recent_activity(db: Session, game_id: int, me: int, limit: int = 6) -> list[dict]:
    """The last few things logged, by whom — merged duplicates included."""
    names = {}

    def who(cid):
        if cid is None:
            return ""
        if cid not in names:
            c = db.get(models.Coach, cid)
            names[cid] = c.name if c else ""
        return names[cid]
    rows = [{"kind": "stat", "id": s.id, "player_name": s.player_name, "stat_name": s.stat_name,
             "is_opponent": bool(s.is_opponent), "by": who(s.logged_by), "you": s.logged_by == me,
             "at": s.created_at.isoformat() + "Z"}
            for s in (db.query(models.GamePlayerStat)
                      .filter(models.GamePlayerStat.game_id == game_id,
                              models.GamePlayerStat.source == "live")
                      .order_by(models.GamePlayerStat.id.desc()).limit(limit).all())]
    for d in (db.query(models.StatDuplicate).filter_by(game_id=game_id, counted=False)
              .order_by(models.StatDuplicate.id.desc()).limit(limit).all()):
        orig = db.get(models.GamePlayerStat, d.original_id) if d.original_id else None
        rows.append({"kind": "merged", "id": d.id, "player_name": d.payload.get("player_name"),
                     "stat_name": d.payload.get("stat_name"), "is_opponent": bool(d.payload.get("is_opponent")),
                     "by": who(d.logged_by), "you": d.logged_by == me,
                     "merged_with": who(orig.logged_by) if orig else "",
                     "at": d.created_at.isoformat() + "Z"})
    rows.sort(key=lambda r: r["at"], reverse=True)
    return rows[:limit]
