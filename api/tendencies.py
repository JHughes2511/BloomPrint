"""Player tendencies, counted from what the film logged.

The film analysis logs individual actions (video_vision/player_events.py);
this counts them. Everything said about a player here is a tally of logged
actions with the tally attached — "drives right 7 of 9" — so a coach can see
how much it rests on, and nothing is said about a player the film barely
showed: they are listed as seen too little rather than described from two
plays.

Who a player is: the team their uniform colour belongs to on that clip
(GameReportClip.uniforms), their jersey number, and — where a roster has that
number — their name.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

from sqlalchemy.orm import Session

from . import models

MIN_EVENTS = 3        # fewer logged actions than this and nothing is said about a player
MIN_PATTERN = 3       # the least a single statement ("drives right 3 of 4") rests on
LEAN = 0.6            # share that makes one option a tendency rather than a mix


def norm(name: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def _team_for(uniforms: dict | None, uniform: str) -> str | None:
    """The team a logged colour belongs to on this clip, or None if unsaid."""
    if not uniforms:
        return None
    u = (uniform or "").lower().strip()
    if u in uniforms:
        return uniforms[u]
    for colour, team in uniforms.items():
        if colour and (colour in u or u in colour):
            return team
    return None


def clip_events(db: Session, clips: list) -> list[dict]:
    """Every logged action on these clips whose team is known."""
    clips = [c for c in clips if c is not None and c.player_events and c.uniforms]
    if not clips:
        return []
    by_id = {c.id: c for c in clips}
    out = []
    for e in (db.query(models.FilmPlayerEvent)
              .filter(models.FilmPlayerEvent.clip_id.in_(list(by_id)))
              .order_by(models.FilmPlayerEvent.clip_id, models.FilmPlayerEvent.t_sec).all()):
        team = _team_for(by_id[e.clip_id].uniforms, e.uniform)
        if not team:
            continue
        out.append({"team": team, "no": e.jersey, "ev": e.ev, "t": e.t_sec,
                    "clip": e.clip_id, **(e.data or {})})
    return out


def _ts(t) -> str:
    return f"{t // 60:02d}:{t % 60:02d}" if isinstance(t, int) else ""


def _ex(evs: list[dict], n: int = 2) -> list[str]:
    """Film timestamps of the first few times it was seen, for the coach to check."""
    stamps = dict.fromkeys(_ts(e.get("t")) for e in evs if isinstance(e.get("t"), int))
    return list(stamps)[:n]


def _parts(counter: Counter) -> list[list]:
    return [[k, v] for k, v in counter.most_common() if v]


def _facts(evs: list[dict]) -> list[dict]:
    """What one player's logged actions add up to, as facts with their counts.

    Facts rather than sentences: the app writes them in the coach's language,
    and english() writes them for a report prompt. Each is {"k": what, ...its
    numbers, "ex": timestamps}.
    """
    by = defaultdict(list)
    for e in evs:
        by[e["ev"]].append(e)
    facts: list[dict] = []

    drives = by.get("drive", [])
    if len(drives) >= MIN_PATTERN:
        dirs = Counter(e.get("dir") for e in drives if e.get("dir"))
        n = sum(dirs.values())
        if n >= MIN_PATTERN:
            side, k = dirs.most_common(1)[0]
            if k / n >= LEAN:
                facts.append({"k": "driveDir", "dir": side, "count": k, "of": n,
                              "ex": _ex([e for e in drives if e.get("dir") == side])})
            else:
                facts.append({"k": "driveBoth", "right": dirs.get("R", 0), "left": dirs.get("L", 0)})
        ends = Counter(e.get("end") for e in drives if e.get("end"))
        if sum(ends.values()) >= MIN_PATTERN:
            facts.append({"k": "driveEnds", "parts": _parts(ends), "of": sum(ends.values())})
        # Direction and finish together: "going left: pull-up 4 of 5".
        for side in ("R", "L"):
            sub = [e for e in drives if e.get("dir") == side and e.get("end")]
            if len(sub) >= MIN_PATTERN:
                end, k = Counter(e["end"] for e in sub).most_common(1)[0]
                if k / len(sub) >= LEAN:
                    facts.append({"k": "goingDir", "dir": side, "end": end, "count": k, "of": len(sub)})
        rim = [e for e in drives if e.get("end") == "rim" and e.get("res") in ("made", "missed")]
        if len(rim) >= MIN_PATTERN:
            facts.append({"k": "rimFinish", "made": sum(e["res"] == "made" for e in rim), "of": len(rim)})

    shots = by.get("shot", [])
    if len(shots) >= MIN_PATTERN:
        how = Counter(e.get("how") for e in shots if e.get("how"))
        if sum(how.values()) >= MIN_PATTERN:
            facts.append({"k": "shotHow", "parts": _parts(how), "of": sum(how.values())})
        zones = Counter(e.get("zone") for e in shots if e.get("zone"))
        if zones:
            facts.append({"k": "shotZones", "parts": [
                [z, sum(1 for e in shots if e.get("zone") == z and e.get("res") == "made"), k]
                for z, k in zones.most_common(3)]})
        threes = [e for e in shots if (e.get("zone") or "").endswith("3") and e.get("res")]
        if len(threes) >= MIN_PATTERN:
            facts.append({"k": "threes", "made": sum(e["res"] == "made" for e in threes), "of": len(threes)})

    pnr = by.get("pnr", [])
    handler = Counter(e.get("read") for e in pnr if e.get("role") == "handler" and e.get("read"))
    if sum(handler.values()) >= 2:
        facts.append({"k": "pnrHandler", "parts": _parts(handler), "of": sum(handler.values())})
    screener = Counter(e.get("act") for e in pnr if e.get("role") == "screener" and e.get("act"))
    if sum(screener.values()) >= 2:
        facts.append({"k": "pnrScreener", "parts": _parts(screener), "of": sum(screener.values())})

    post = by.get("post", [])
    if len(post) >= 2:
        facts.append({"k": "post", "count": len(post),
                      "shoulders": _parts(Counter(e.get("dir") for e in post if e.get("dir"))),
                      "parts": _parts(Counter(e.get("end") for e in post if e.get("end")))})

    efforts = Counter(e.get("effort") for e in by.get("transition", []) if e.get("effort"))
    n = sum(efforts.values())
    if n >= 2:
        sprint, jog = efforts.get("sprint", 0), efforts.get("jog", 0)
        if sprint / n >= 0.7:
            facts.append({"k": "runHard", "count": sprint, "of": n})
        elif jog / n >= LEAN:
            facts.append({"k": "runJog", "count": jog, "of": n})
        else:
            facts.append({"k": "runSometimes", "count": sprint, "of": n})

    off = by.get("off_ball", [])
    acts = Counter(e.get("act") for e in off if e.get("act"))
    cuts = [e for e in off if e.get("act") == "cut"]
    if len(cuts) >= 2:
        facts.append({"k": "cuts", "count": len(cuts),
                      "scored": sum(1 for e in cuts if e.get("res") == "scored"),
                      "open": sum(1 for e in cuts if e.get("res") == "open"), "ex": _ex(cuts)})
    moving = acts.get("cut", 0) + acts.get("relocate", 0) + acts.get("screen", 0)
    if acts.get("stand", 0) >= 2:
        facts.append({"k": "stagnantOff", "count": acts["stand"], "moving": moving,
                      "ex": _ex([e for e in off if e.get("act") == "stand"])})
    elif moving >= MIN_PATTERN:
        facts.append({"k": "movesWell", "count": moving})

    d = Counter(e.get("act") for e in by.get("defense", []) if e.get("act"))
    dparts = [[a, k] for a, k in d.most_common() if a != "ball_watch" and k >= 2]
    if dparts:
        facts.append({"k": "defense", "parts": dparts})
    if d.get("ball_watch", 0) >= 2:
        facts.append({"k": "stagnantDef", "count": d["ball_watch"],
                      "ex": _ex([e for e in by.get("defense", []) if e.get("act") == "ball_watch"])})
    return facts


# English, for report prompts. The app has its own copy of these in every
# language (teamGrade.tend.* and teamGrade.tendWord.*).
WORDS = {
    "rim": "all the way to the rim", "pull_up": "pull-up", "floater": "floater", "kick": "kicks out",
    "stopped": "stopped", "catch": "catch-and-shoot", "dribble": "off the dribble", "paint": "paint",
    "mid": "mid-range", "corner3": "corner 3", "wing3": "wing 3", "top3": "top 3",
    "use": "uses the screen", "reject": "rejects it", "split": "splits it", "pass": "passes out",
    "shoot": "shoots off it", "roll": "rolls", "pop": "pops", "slip": "slips",
    "shot": "shoots", "turnover": "turns it over",
    "pressure": "pressures the ball", "gamble": "gambles for steals", "late_closeout": "late closeouts",
    "good_closeout": "good closeouts", "help": "helps", "beaten": "beaten off the dribble",
    "foul": "fouls", "steal": "steals", "block": "blocks",
}
ZONE_WORDS = {**WORDS, "rim": "at the rim"}


def _join(parts, words=WORDS) -> str:
    return ", ".join(f"{words.get(w, w)} {c}" for w, c in parts)


def english(f: dict) -> str:
    """One fact as a line of a report prompt."""
    k = f["k"]
    side = lambda d: "right" if d == "R" else "left"  # noqa: E731
    ex = f" (e.g. {', '.join(f['ex'])})" if f.get("ex") else ""
    if k == "driveDir":
        return f"Drives {side(f['dir'])} {f['count']} of {f['of']}{ex}"
    if k == "driveBoth":
        return f"Drives both ways (right {f['right']}, left {f['left']})"
    if k == "driveEnds":
        return f"Drives end: {_join(f['parts'])} of {f['of']}"
    if k == "goingDir":
        return f"Going {side(f['dir'])}: {WORDS[f['end']]} {f['count']} of {f['of']}"
    if k == "rimFinish":
        return f"Finishing at the rim: {f['made']} of {f['of']}"
    if k == "shotHow":
        return f"Shots: {_join(f['parts'])} of {f['of']}"
    if k == "shotZones":
        return "Shoots from: " + ", ".join(f"{ZONE_WORDS[z]} {m}/{a}" for z, m, a in f["parts"])
    if k == "threes":
        return f"Threes: {f['made']} of {f['of']}"
    if k == "pnrHandler":
        return f"Ball screens as the handler: {_join(f['parts'])} of {f['of']}"
    if k == "pnrScreener":
        return f"Ball screens as the screener: {_join(f['parts'])} of {f['of']}"
    if k == "post":
        sh = ", ".join(f"{side(d)} shoulder {c}" for d, c in f["shoulders"])
        return f"Post-ups ({f['count']}): " + "; ".join(x for x in (
            f"turns over the {sh}" if sh else "", _join(f["parts"])) if x)
    if k == "runHard":
        return f"Runs the floor hard ({f['count']} of {f['of']})"
    if k == "runJog":
        return f"Does not run the floor: jogs {f['count']} of {f['of']}"
    if k == "runSometimes":
        return f"Runs the floor sometimes (sprints {f['count']} of {f['of']})"
    if k == "cuts":
        return (f"Cuts: {f['count']}" + (f", scored {f['scored']}" if f["scored"] else "")
                + (f", got open {f['open']}" if f["open"] else "") + ex)
    if k == "stagnantOff":
        return (f"Stagnant on offense: standing and watching {f['count']} times"
                + (f" (moving without the ball {f['moving']})" if f["moving"] else "") + ex)
    if k == "movesWell":
        return f"Moves well without the ball ({f['count']} cuts, relocations and screens)"
    if k == "defense":
        return "Defense: " + _join(f["parts"])
    if k == "stagnantDef":
        return f"Stagnant on defense: loses their player watching the ball {f['count']} times{ex}"
    return ""


def tendencies(events: list[dict], rosters: dict[str, dict[str, str]] | None = None) -> list[dict]:
    """Per player: who, how much the film showed, and what it adds up to.

    `rosters` is {team name: {jersey: player name}}; teams are matched loosely
    ("SEED Academy" / "seed academy").
    """
    names = {norm(t): r for t, r in (rosters or {}).items()}
    grouped: dict[tuple, list] = defaultdict(list)
    for e in events:
        grouped[(e["team"], e["no"])].append(e)
    out = []
    for (team, no), evs in grouped.items():
        facts = _facts(evs) if len(evs) >= MIN_EVENTS else []
        out.append({"team": team, "jersey": no, "name": names.get(norm(team), {}).get(no),
                    "events": len(evs), "facts": facts, "lines": [english(f) for f in facts]})
    out.sort(key=lambda p: (norm(p["team"]), -p["events"]))
    return out


def render(players: list[dict], heading: str = "PLAYER TENDENCIES FROM FILM") -> str:
    """The block a report prompt is given."""
    shown = [p for p in players if p["lines"]]
    if not shown:
        return ""
    out = [f"\n\n{heading} (counted from individual actions logged in the film — each "
           "figure is how many times it was seen; film timestamps in brackets):"]
    for team in dict.fromkeys(p["team"] for p in players):
        team_players = [p for p in shown if p["team"] == team]
        thin = [p for p in players if p["team"] == team and not p["lines"]]
        if not team_players and not thin:
            continue
        out.append(f"\n{team}:")
        for p in team_players:
            who = f"#{p['jersey']}" + (f" {p['name']}" if p["name"] else "")
            out.append(f"  {who} ({p['events']} actions seen): " + "; ".join(p["lines"]))
        if thin:
            out.append("  Seen too little to call: "
                       + ", ".join(f"#{p['jersey']}" + (f" {p['name']}" if p["name"] else "") for p in thin))
    return "\n".join(out)


REPORT_DIRECTIVE = (
    "\n\nInclude a PLAYER TENDENCIES section: for each key player on both teams, what they "
    "like to do — which way they go, whether they pull up or get all the way to the rim, "
    "where they shoot from, how they use ball screens, whether they run the floor, move "
    "without the ball, cut, or go stagnant on offense or defense — using ONLY the counts in "
    "PLAYER TENDENCIES FROM FILM above, and quoting them (e.g. 'drives right 7 of 9'). Name "
    "a player by jersey and name. Say what it means for the game plan (how to guard the player, "
    "or how the player can be used). Never describe a tendency the counts do not show; a player "
    "listed as seen too little is said to be so."
)


# ── Rosters: jersey -> name for the teams on screen ──────────────────────────

def _team_roster(db: Session, team_id: int | None) -> dict[str, str]:
    if not team_id:
        return {}
    return {str(p.jersey_number).strip().lstrip("#"): p.name
            for p in db.query(models.Player).filter_by(team_id=team_id).all()
            if p.jersey_number and str(p.jersey_number).strip()}


def _opponent_roster(db: Session, coach_id: int, opponent: str) -> dict[str, str]:
    out = {}
    for p in db.query(models.OpponentPlayer).filter_by(coach_id=coach_id).all():
        if norm(p.opponent_name) == norm(opponent) and p.jersey_number:
            out[str(p.jersey_number).strip().lstrip("#")] = p.player_name
    # A team the coach built in Roster under that name counts too.
    for t in db.query(models.Team).filter_by(coach_id=coach_id).all():
        if norm(t.name) == norm(opponent):
            out = {**_team_roster(db, t.id), **out}
    return out


def for_game(db: Session, game: models.GameSession, clips: list | None = None) -> list[dict]:
    """Tendencies from the films of this tracked game (all linked ones, or `clips`)."""
    if clips is None:
        clips = db.query(models.GameReportClip).filter_by(game_id=game.id).all()
    events = clip_events(db, clips)
    if not events:
        return []
    team = db.get(models.Team, game.team_id) if game.team_id else None
    rosters = {game.opponent_name: _opponent_roster(db, game.coach_id, game.opponent_name)}
    if team:
        rosters[team.name] = _team_roster(db, team.id)
    return tendencies(events, rosters)


def for_packet(db: Session, gr: models.GameReport) -> list[dict]:
    """Tendencies from every film in a film packet."""
    events = clip_events(db, list(gr.clips))
    if not events:
        return []
    rosters = {}
    for team in (gr.my_team, gr.opponent_team):
        if team:
            rosters[team.name] = _team_roster(db, team.id)
    for t in {e["team"] for e in events}:
        if norm(t) not in {norm(k) for k in rosters}:
            rosters[t] = _opponent_roster(db, gr.coach_id, t)
    return tendencies(events, rosters)


def for_opponent(db: Session, coach_id: int, opponent: str) -> list[dict]:
    """One team's players across every film this coach has of them."""
    clips = (db.query(models.GameReportClip)
             .join(models.GameReport, models.GameReport.id == models.GameReportClip.game_report_id)
             .filter(models.GameReport.coach_id == coach_id,
                     models.GameReportClip.player_events.is_(True)).all())
    events = [e for e in clip_events(db, clips) if norm(e["team"]) == norm(opponent)]
    if not events:
        return []
    players = tendencies(events, {opponent: _opponent_roster(db, coach_id, opponent)})
    games = defaultdict(set)
    for e in events:
        games[e["no"]].add(e["clip"])
    for p in players:
        p["films"] = len(games[p["jersey"]])
    return players
