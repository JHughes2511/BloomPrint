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
