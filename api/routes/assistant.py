"""BloomPrint AI copilot — a command-bar agent.

The coach types a question or task; Claude runs a tool-use loop over READ tools
(all scoped to the coach's own data), a NAVIGATION tool (returns a "Take me
there" target), and a PROPOSE-GENERATION tool (never runs on its own). Anything
that would create a real, costed artifact comes back as a pending action the app
confirms, then runs via /assistant/confirm.
"""
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models

router = APIRouter(prefix="/assistant", tags=["assistant"])


# ── Scoping helpers ───────────────────────────────────────────────────────────

def _team_ids(db: Session, coach: models.Coach) -> set[int]:
    ids = {tm.id for tm in db.query(models.Team).filter_by(coach_id=coach.id).all()}
    ids |= {l.team_id for l in db.query(models.TeamStaff).filter_by(coach_id=coach.id).all()}
    return ids


def _coach_players(db: Session, coach: models.Coach):
    from sqlalchemy import or_
    tids = _team_ids(db, coach)
    conds = [models.Player.coach_id == coach.id]
    if tids:
        conds.append(models.Player.team_id.in_(tids))
    return db.query(models.Player).filter(or_(*conds)).all()


def _coach_games(db: Session, coach: models.Coach):
    from sqlalchemy import or_
    tids = _team_ids(db, coach)
    conds = [models.GameSession.coach_id == coach.id]
    if tids:
        conds.append(models.GameSession.team_id.in_(tids))
    return db.query(models.GameSession).filter(or_(*conds)).order_by(models.GameSession.date.desc()).all()


def _find_game(db, coach, game_id=None, opponent_name=None):
    games = _coach_games(db, coach)
    if game_id:
        return next((g for g in games if g.id == int(game_id)), None)
    if opponent_name:
        on = str(opponent_name).strip().lower()
        exact = [g for g in games if (g.opponent_name or "").lower() == on]
        if exact:
            return exact[0]
        part = [g for g in games if on and on in (g.opponent_name or "").lower()]
        return part[0] if part else None
    return None


def _find_player(db, coach, ref):
    """Resolve a player by id or (fuzzy) name, scoped to the coach."""
    players = _coach_players(db, coach)
    if isinstance(ref, int) or (isinstance(ref, str) and ref.isdigit()):
        pid = int(ref)
        return next((p for p in players if p.id == pid), None)
    rl = str(ref or "").strip().lower()
    if not rl:
        return None
    exact = [p for p in players if p.name.lower() == rl]
    if exact:
        return exact[0]
    partial = [p for p in players if rl in p.name.lower()]
    return partial[0] if partial else None


# ── Tool implementations (return compact dicts) ───────────────────────────────

def t_search_players(db, coach, query: str = "") -> dict:
    from .players import _composite_bim
    q = (query or "").strip().lower()
    out = []
    for p in _coach_players(db, coach):
        if q and q not in p.name.lower() and q not in (p.position or "").lower() and q not in (p.program_name or "").lower():
            continue
        own = [e for e in p.evaluations if e.coach_id == coach.id]
        grade, _pil, cnt = _composite_bim(p, own or list(p.evaluations))
        out.append({"id": p.id, "name": p.name, "position": p.position,
                    "team": p.program_name, "level": p.competition_level,
                    "bim_grade": grade, "reports": cnt})
    return {"players": out[:60], "count": len(out)}


def t_player_detail(db, coach, player: str) -> dict:
    from .players import _composite_bim
    p = _find_player(db, coach, player)
    if not p:
        return {"error": f"No player found matching '{player}'."}
    own = [e for e in p.evaluations if e.coach_id == coach.id] or list(p.evaluations)
    grade, pillars, cnt = _composite_bim(p, own)
    evs = sorted(own, key=lambda e: e.created_at or datetime.min)
    latest = evs[-1] if evs else None
    return {
        "id": p.id, "name": p.name, "position": p.position, "team": p.program_name,
        "level": p.competition_level, "height": p.height, "wingspan": p.wingspan,
        "bim_grade": grade, "pillars": pillars, "report_count": cnt,
        "green_flags": (latest.green_flags if latest else None),
        "watch_flags": (latest.watch_flags if latest else None),
        "eval_history": [
            {"id": e.id, "type": e.output_type, "grade": e.overall_grade,
             "date": e.created_at.strftime("%Y-%m-%d") if e.created_at else None}
            for e in evs
        ],
    }


def t_player_game_history(db, coach, player_name: str) -> dict:
    from .game_eval import player_tracked_stats_block
    p = _find_player(db, coach, player_name)
    name = p.name if p else player_name
    game_ids = [g.id for g in _coach_games(db, coach)]
    block = player_tracked_stats_block(db, coach.id, name, game_ids)
    return {"player": name, "tracked_stats": block or "No tracked box-score games for this player."}


def t_list_games(db, coach, season_year: str = "", phase: str = "") -> dict:
    out = []
    for g in _coach_games(db, coach):
        if season_year and (g.season_year or "") != season_year:
            continue
        if phase and (g.season_phase or "") != phase:
            continue
        res = None
        if g.our_score is not None and g.opponent_score is not None:
            res = "W" if g.our_score > g.opponent_score else ("L" if g.our_score < g.opponent_score else "T")
        out.append({"id": g.id, "opponent": g.opponent_name,
                    "date": g.date.strftime("%Y-%m-%d") if g.date else None,
                    "score": (f"{g.our_score}-{g.opponent_score}" if g.our_score is not None else None),
                    "result": res, "phase": g.season_phase, "status": g.status})
    return {"games": out[:80], "count": len(out)}


def t_game_summary(db, coach, game_id: int) -> dict:
    from .game_eval import _compute_grades
    g = next((x for x in _coach_games(db, coach) if x.id == int(game_id)), None)
    if not g:
        return {"error": "Game not found."}
    mp = db.query(models.GameMinutesPlayed).filter_by(game_id=g.id).all()
    our_min = {r.player_name: r.minutes_played for r in mp if not r.is_opponent}
    our = _compute_grades([s for s in g.player_stats if not s.is_opponent], our_min)
    opp = _compute_grades([s for s in g.player_stats if s.is_opponent], {})
    return {"opponent": g.opponent_name, "score": (f"{g.our_score}-{g.opponent_score}" if g.our_score is not None else None),
            "player_grades": our[:15], "opponent_grades": opp[:15]}


def t_opponent_analysis(db, coach, opponent_name: str) -> dict:
    games = [g for g in _coach_games(db, coach) if (g.opponent_name or "").lower() == (opponent_name or "").lower()]
    if not games:
        # fuzzy
        games = [g for g in _coach_games(db, coach) if (opponent_name or "").lower() in (g.opponent_name or "").lower()]
    if not games:
        return {"error": f"No games found vs '{opponent_name}'."}
    rec = {"W": 0, "L": 0}
    off_t, def_t = defaultdict(int), defaultdict(int)
    for g in games:
        if g.our_score is not None and g.opponent_score is not None:
            rec["W" if g.our_score > g.opponent_score else "L"] += 1
        for s in g.player_stats:
            if s.is_opponent:
                (off_t if s.stat_category == "offense" else def_t)[s.stat_name] += s.count
    top_off = sorted(off_t.items(), key=lambda x: -x[1])[:4]
    top_def = sorted(def_t.items(), key=lambda x: -x[1])[:4]
    return {"opponent": games[0].opponent_name, "games": len(games), "record": rec,
            "offensive_tendencies": [{"stat": s, "count": c} for s, c in top_off],
            "defensive_tendencies": [{"stat": s, "count": c} for s, c in top_def]}


def t_season_dashboard(db, coach, season_year: str = "", phase: str = "") -> dict:
    from .game_eval import _compute_grades
    games = [g for g in _coach_games(db, coach) if g.status == "completed"]
    if season_year:
        games = [g for g in games if (g.season_year or "") == season_year]
    if phase:
        games = [g for g in games if (g.season_phase or "") == phase]
    wins = losses = 0
    trend = []
    for g in games:
        if g.our_score is not None and g.opponent_score is not None:
            if g.our_score > g.opponent_score:
                wins += 1
            else:
                losses += 1
        trend.append({"opponent": g.opponent_name,
                      "date": g.date.strftime("%Y-%m-%d") if g.date else None,
                      "score": (f"{g.our_score}-{g.opponent_score}" if g.our_score is not None else None)})
    return {"record": {"wins": wins, "losses": losses}, "games": trend[:40]}


def t_list_reports(db, coach, kind: str = "") -> dict:
    out = []
    if kind in ("", "eval"):
        for e in db.query(models.Evaluation).filter_by(coach_id=coach.id).order_by(models.Evaluation.created_at.desc()).limit(40).all():
            pl = db.get(models.Player, e.player_id)
            out.append({"kind": "eval", "id": e.id, "subject": pl.name if pl else "Player",
                        "type": e.output_type, "grade": e.overall_grade,
                        "date": e.created_at.strftime("%Y-%m-%d") if e.created_at else None})
    if kind in ("", "team"):
        for tr in db.query(models.TeamReport).filter_by(coach_id=coach.id).order_by(models.TeamReport.created_at.desc()).limit(20).all():
            out.append({"kind": "team", "id": tr.id, "subject": "Team Report", "type": tr.output_type,
                        "date": tr.created_at.strftime("%Y-%m-%d") if tr.created_at else None})
    if kind in ("", "packet", "game"):
        for gr in db.query(models.GameReport).filter_by(coach_id=coach.id).order_by(models.GameReport.updated_at.desc()).limit(20).all():
            out.append({"kind": "packet", "id": gr.id, "subject": gr.title or gr.opponent_name or "Game Report",
                        "type": gr.output_type, "ready": bool(gr.report_text)})
    return {"reports": out}


def t_get_report_text(db, coach, kind: str, id: int) -> dict:
    id = int(id)
    if kind == "eval":
        e = db.get(models.Evaluation, id)
        if e and e.coach_id == coach.id:
            return {"text": (e.report_text or "")[:6000]}
    if kind == "team":
        tr = db.get(models.TeamReport, id)
        if tr and tr.coach_id == coach.id:
            return {"text": (tr.report_text or "")[:6000]}
    if kind in ("packet", "game"):
        gr = db.get(models.GameReport, id)
        if gr and gr.coach_id == coach.id:
            return {"text": (gr.report_text or "")[:6000]}
    return {"error": "Report not found."}


def t_list_plays(db, coach, game_id: int = 0) -> dict:
    q = db.query(models.GameWhiteboard).filter_by(coach_id=coach.id)
    if game_id:
        q = q.filter_by(game_id=int(game_id))
    out = []
    for w in q.order_by(models.GameWhiteboard.updated_at.desc()).limit(60).all():
        g = db.get(models.GameSession, w.game_id)
        out.append({"id": w.id, "name": w.name, "game_id": w.game_id,
                    "opponent": g.opponent_name if g else None,
                    "court_type": w.court_type,
                    "created_at": w.created_at.strftime("%Y-%m-%d") if w.created_at else None})
    return {"plays": out}


def t_list_training(db, coach, player: str = "") -> dict:
    p = _find_player(db, coach, player) if player else None
    q = db.query(models.TrainingSession).filter_by(coach_id=coach.id)
    if p:
        q = q.filter_by(player_id=p.id)
    out = [{"id": ts.id, "player_id": ts.player_id,
            "date": ts.created_at.strftime("%Y-%m-%d") if ts.created_at else None}
           for ts in q.order_by(models.TrainingSession.created_at.desc()).limit(30).all()]
    return {"training_programs": out}


TOOLS = [
    {"name": "search_players", "description": "List/search the coach's players (name, position, team, level, BIM grade, report count).",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string", "description": "optional name/position/team filter"}}}},
    {"name": "player_detail", "description": "Full detail for one player: BIM composite grade, pillar grades, green/watch flags, and eval history (with eval ids/dates).",
     "input_schema": {"type": "object", "properties": {"player": {"type": "string", "description": "player name or id"}}, "required": ["player"]}},
    {"name": "player_game_history", "description": "A player's real tracked box-score stats across games.",
     "input_schema": {"type": "object", "properties": {"player_name": {"type": "string"}}, "required": ["player_name"]}},
    {"name": "list_games", "description": "The coach's tracked games with opponent, date, score, W/L result.",
     "input_schema": {"type": "object", "properties": {"season_year": {"type": "string"}, "phase": {"type": "string"}}}},
    {"name": "game_summary", "description": "Per-player grades for one tracked game (our team + opponent).",
     "input_schema": {"type": "object", "properties": {"game_id": {"type": "integer"}}, "required": ["game_id"]}},
    {"name": "opponent_analysis", "description": "Record and tendencies vs a specific opponent across all games.",
     "input_schema": {"type": "object", "properties": {"opponent_name": {"type": "string"}}, "required": ["opponent_name"]}},
    {"name": "season_dashboard", "description": "Season record and game-by-game trend.",
     "input_schema": {"type": "object", "properties": {"season_year": {"type": "string"}, "phase": {"type": "string"}}}},
    {"name": "list_reports", "description": "The coach's saved reports (evals, team reports, game packets) with ids so you can locate one.",
     "input_schema": {"type": "object", "properties": {"kind": {"type": "string", "enum": ["", "eval", "team", "packet"]}}}},
    {"name": "get_report_text", "description": "The full text of a specific saved report.",
     "input_schema": {"type": "object", "properties": {"kind": {"type": "string"}, "id": {"type": "integer"}}, "required": ["kind", "id"]}},
    {"name": "list_plays", "description": "Whiteboard plays the coach drew up (optionally for one game).",
     "input_schema": {"type": "object", "properties": {"game_id": {"type": "integer"}}}},
    {"name": "list_training", "description": "Training programs (optionally for one player).",
     "input_schema": {"type": "object", "properties": {"player": {"type": "string"}}}},
    {"name": "suggest_navigation", "description": (
        "Show the coach a 'Take me there' button that opens the right screen. Use for 'where is X' / 'how "
        "do I Y' / 'take me to Z'. Use EXACTLY one of these screen values:\n"
        "- 'home' — Home dashboard.\n"
        "- 'roster' — ROSTER tab: all players + teams. This is where you ADD A PLAYER (the + button), "
        "CREATE A TEAM (the 'New Team' chip), and start a roster import.\n"
        "- 'add_team' — Roster (for creating a team). 'add_player' — Roster (for adding a player).\n"
        "- 'import' — the Import screen (AI-reads any file: Excel/CSV/PDF/photo) to bulk-add players.\n"
        "- 'player' — one player's profile (params: player_id). Their evals, training, film catalog, invite code.\n"
        "- 'new_eval' — start a NEW film/AI eval on a player (params: player_id) — the coach attaches film "
        "and/or picks report types. Use this for a fresh eval that needs film.\n"
        "- 'training' — generate a training program for a player (params: player_id).\n"
        "- 'eval_report' — a specific saved eval (params: eval_id; optional share='player' to open "
        "Send-to-Player, or share='staff' to open Share-with-Staff so the coach picks recipient + toggles). "
        "Use the share param when the coach wants to SEND/SHARE that eval.\n"
        "- 'recent' — the Recent tab: every saved report (evals, team reports, packets, scouting, training).\n"
        "- 'team_eval' — the TEAM EVAL tab: Quick team reports, game-report PACKETS, and the team film "
        "catalog (params: report_id opens a specific packet).\n"
        "- 'game_report_builder' — a FRESH Game Report Builder (Team Eval tab). Pick a report type + "
        "matchup mode, TYPE ANY opponent (no tracked game needed), optionally attach film/box-score/notes. "
        "Use whenever a coach wants a game report/packet for a matchup with no tracked game.\n"
        "- 'team_grade' — the TEAM GRADE tab: track/log games (live or post-game), enter box-score stats, "
        "season dashboard + leaderboard, opponent scouting, and the whiteboard/plays. Use for 'how do I "
        "track a game', stats, standings.\n"
        "- 'track_game' / 'new_game' — Team Grade (to start a new game).\n"
        "- 'game_detail' — one tracked game's detail (params: game_id).\n"
        "- 'scout' — opponent scouting (Team Grade → Scout).\n"
        "- 'whiteboard' — the whiteboard/plays (Team Grade).\n"
        "- 'staff_inbox' — the Staff Hub: reports other coaches shared with you, staff teams/games, AND "
        "MESSAGES (conversations with other staff — coaches CAN message each other here). Use for "
        "'message a coach', 'send Mike a message', staff chat.\n"
        "- 'notifications' — coach notifications.\n"
        "- 'edit_profile' — Home (the profile/Edit Profile + Competition Level is opened from the Home "
        "top-right user icon).\n"
        "Do NOT invent other screen names."),
     "input_schema": {"type": "object", "properties": {"screen": {"type": "string"}, "player_id": {"type": "integer"}, "eval_id": {"type": "integer"}, "report_id": {"type": "integer"}, "game_id": {"type": "integer"}, "share": {"type": "string", "enum": ["player", "staff"], "description": "for eval_report: open Send-to-Player or Share-with-Staff"}, "label": {"type": "string", "description": "button text"}}, "required": ["screen", "label"]}},
    {"name": "propose_generation", "description": (
        "Propose creating a NEW report the coach must confirm before it runs. Do NOT run generation "
        "yourself. Supported kinds:\n"
        "- 'player_summary' (args: player_id REQUIRED, months optional, output_type optional) — a report "
        "synthesized from a player's eval history. For a RECRUITING/SCOUTING report on the coach's own "
        "player (to send to a scout / evaluate potential), use this kind with output_type='scouting_report'.\n"
        "- 'team_report' (args: team_id optional) — a report across a team's roster.\n"
        "- 'scouting_report' (args: game_id OR opponent_name) — PRE-GAME OPPONENT scouting only.\n"
        "- 'game_report' (args: game_id OR opponent_name) — our-team + opponent game report.\n"
        "For player generations, pass the exact player_id you confirmed via player_detail. Anything "
        "needing NEW film is NOT supported — use suggest_navigation to 'new_eval'. Always include a short "
        "human description that names the exact player/team/opponent."),
     "input_schema": {"type": "object", "properties": {"kind": {"type": "string"}, "player_id": {"type": "integer"}, "team_id": {"type": "integer"}, "game_id": {"type": "integer"}, "opponent_name": {"type": "string"}, "months": {"type": "integer"}, "output_type": {"type": "string"}, "description": {"type": "string"}}, "required": ["kind", "description"]}},
]


def _run_tool(name, args, db, coach, result):
    if name == "search_players":
        return t_search_players(db, coach, args.get("query", ""))
    if name == "player_detail":
        return t_player_detail(db, coach, args.get("player", ""))
    if name == "player_game_history":
        return t_player_game_history(db, coach, args.get("player_name", ""))
    if name == "list_games":
        return t_list_games(db, coach, args.get("season_year", ""), args.get("phase", ""))
    if name == "game_summary":
        return t_game_summary(db, coach, args.get("game_id", 0))
    if name == "opponent_analysis":
        return t_opponent_analysis(db, coach, args.get("opponent_name", ""))
    if name == "season_dashboard":
        return t_season_dashboard(db, coach, args.get("season_year", ""), args.get("phase", ""))
    if name == "list_reports":
        return t_list_reports(db, coach, args.get("kind", ""))
    if name == "get_report_text":
        return t_get_report_text(db, coach, args.get("kind", ""), args.get("id", 0))
    if name == "list_plays":
        return t_list_plays(db, coach, args.get("game_id", 0))
    if name == "list_training":
        return t_list_training(db, coach, args.get("player", ""))
    if name == "suggest_navigation":
        result["navigate"] = {"screen": args.get("screen"), "label": args.get("label", "Take me there"),
                              "params": {k: args[k] for k in ("player_id", "eval_id", "report_id", "game_id", "share") if args.get(k) is not None}}
        return {"ok": "Navigation button shown to the user."}
    if name == "propose_generation":
        result["pending_action"] = {k: v for k, v in args.items() if v is not None}
        return {"ok": "Confirmation prompt shown; it will run only after the coach approves."}
    return {"error": f"Unknown tool {name}"}


SYSTEM = (
    "You are BloomPrint Copilot, the in-app assistant for a basketball COACH using BloomPrint. You can "
    "ANSWER with the coach's real data, GUIDE them to any screen with step-by-step how-tos, and CREATE "
    "reports (confirm-first). You know the whole app — never say you can't do something the app can do; "
    "if you're unsure, take them to the right screen and explain the steps.\n\n"

    "WHAT BLOOMPRINT IS: it runs the Basketball Intelligence Model (BIM), grading players 0–10 across six "
    "pillars — Offensive Skills, Defensive, Physical, Intangibles, Advanced, Strategic Fit — always "
    "calibrated to the player's/team's COMPETITION LEVEL.\n\n"

    "YOUR DATA ACCESS is live and scoped to THIS coach only. Use the read tools to answer with real "
    "numbers — never invent players, games, grades, or reports. If it isn't there, say so.\n\n"

    "THE APP MAP (5 bottom tabs):\n"
    "- HOME — dashboard, the 6 pillars, and Edit Profile (top-right user icon → name, role, program, "
    "COMPETITION LEVEL, program system/philosophy). Top-right icons also open Staff Inbox (mail) and "
    "Notifications (bell).\n"
    "- ROSTER — all players and teams. Add a player (+), create a team (the 'New Team' chip), import a "
    "roster, open a player.\n"
    "- TEAM EVAL — build team reports (Quick Report) and game-report PACKETS (Game Report Builder), plus "
    "the team FILM CATALOG.\n"
    "- TEAM GRADE — track games (live or post-game) with box-score grading, season dashboard + "
    "leaderboard, opponent SCOUTING, and the whiteboard/plays.\n"
    "- RECENT — every saved report in one feed (evals, team reports, packets, scouting, training), plus "
    "reports shared with you.\n\n"

    "HOW-TO PLAYBOOK — when the coach asks 'how do I …' / 'where do I …', give the FULL step sequence AND "
    "call suggest_navigation so a 'Take me there' button opens the right screen:\n"
    "- ADD A TEAM → 'add_team' (Roster): tap the 'New Team' chip in the team row, name it, pick its "
    "competition level, Create. (You can also create a team inside New Game.)\n"
    "- ADD A PLAYER → 'add_player' (Roster): tap + (top right), enter Full Name (required), team, "
    "position, jersey, measurements, competition level, parent permission, Add.\n"
    "- IMPORT PLAYERS → 'import': pick or create a team, pick ANY file (Excel/CSV/PDF/photo), Analyze "
    "File, toggle the players you want, Import.\n"
    "- TRACK A GAME (live) → 'track_game' (Team Grade → Games → New Game): enter opponent (required), "
    "team, competition level, date, phase, choose Live Track, then tap a player and tap stat buttons as "
    "the game runs; End Game when done.\n"
    "- TRACK A GAME (post-game / box score) → 'track_game': New Game → Post-Game, then 'Import Box Score "
    "(.xlsx)' → preview → commit (works for your team or the opponent).\n"
    "- RUN A NEW FILM EVAL on a player → 'new_eval' (player_id): pick report type(s), attach film and/or "
    "select tracked games for box-score, add notes/focus, Run BIM Analysis.\n"
    "- SUMMARIZE a player's eval history → open 'player' then 'Summarize Evaluation History' (or just "
    "offer to create it — see CREATE).\n"
    "- TRAINING PROGRAM → 'training' (player_id): add focus, Generate Program.\n"
    "- TEAM REPORT (Quick Report) → 'team_eval': pick team/all, report type(s), focus, optional film, "
    "Generate.\n"
    "- GAME REPORT PACKET → 'game_report_builder': name it, pick matchup mode, teams/opponent, report "
    "type(s), attach film + box score + scouting notes, Generate. No tracked game required.\n"
    "- OPPONENT SCOUTING → 'scout' (Team Grade → Scout): pick the opponent to get a scouting report.\n"
    "- WHITEBOARD / PLAYS → 'whiteboard' (Team Grade): draw or AI-generate plays; the playbook persists.\n"
    "- EDIT PROFILE / COMPETITION LEVEL → 'edit_profile' (Home top-right user icon).\n"
    "- LINK A PLAYER'S ACCOUNT (so they can receive reports) → open 'player' → 'Generate Player Invite "
    "Code' → share the code/QR.\n"
    "- FIND FILM → a player's clips: open 'player' → Film Catalog; team/packet clips: 'team_eval' → Film "
    "Catalog (bottom).\n"
    "- MESSAGE ANOTHER COACH / STAFF → 'staff_inbox' (Staff Hub). It HAS a Messages section with "
    "conversations — coaches on your staff CAN message each other (not just share reports). To message "
    "someone: Staff Inbox → Messages → New → pick the staff member → type your message. NEVER say "
    "messaging between coaches isn't supported — it is.\n\n"

    "CREATE (confirm-first) — call propose_generation; NEVER generate directly; the coach approves first. "
    "Before ANY player generation, first call player_detail/search_players to get the EXACT player_id — "
    "never guess an id or a player you haven't looked up. Kinds:\n"
    "- 'player_summary' (player_id; months, output_type optional) — a report synthesized from a player's "
    "eval history. For a RECRUITING/SCOUTING report ON ONE OF THE COACH'S OWN PLAYERS (pitch them to a "
    "college/NBA scout, evaluate potential), use this with output_type='scouting_report'. NEVER refuse "
    "scouting a coach's own player.\n"
    "- 'team_report' (team_id optional) — a report across a team's roster.\n"
    "- 'scouting_report' (game_id OR opponent_name) — PRE-GAME OPPONENT scouting only.\n"
    "- 'game_report' (game_id OR opponent_name) — our-team + opponent report, ONLY when a tracked game "
    "exists; otherwise send them to 'game_report_builder'.\n"
    "Things that need FILM or the builder UI are NOT proposable — navigate instead: a fresh film eval → "
    "'new_eval'; a training program → 'training'; a packet with attached film → 'game_report_builder'.\n\n"

    "SEND / SHARE REPORTS — fully supported; never say otherwise. Every saved report can be SENT TO A "
    "PLAYER (into the player's inbox — they must have linked via an invite code) or SHARED WITH STAFF "
    "(search a coach/staff recipient, pick which sections to include and whether they can regenerate). "
    "When the coach wants to send/share (e.g. 'send AJ's eval to Jaire'): locate the exact eval "
    "(player_detail / list_reports), or if none exists propose_generation to create it, then "
    "suggest_navigation to 'eval_report' with that eval_id and share='staff' (to another person) or "
    "share='player' (to the player) — this opens the share sheet with recipient + section toggles.\n\n"

    "IF YOU TRULY CAN'T map a request: don't say a flat 'I couldn't work that out'. Say briefly what you "
    "CAN help with (pull data, take them to any screen and explain the steps, or create a report) and "
    "offer the closest screen.\n\n"

    "STYLE: plain text, lead with the answer, ALL-CAPS section titles and '- ' bullets when listing steps, "
    "and keep it tight and coach-facing."
)


class AskBody(BaseModel):
    message: str
    history: list[dict] = []   # [{role, content}] prior turns (text only)


@router.post("/ask")
def ask(body: AskBody, db: Session = Depends(get_db), coach: models.Coach = Depends(get_current_coach)):
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured.")
    import anthropic
    client = anthropic.Anthropic()

    messages = []
    for h in (body.history or [])[-12:]:
        role = h.get("role")
        content = h.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": body.message})

    result = {"navigate": None, "pending_action": None}
    reply_text = ""
    for _ in range(6):  # bounded tool-use loop
        resp = client.messages.create(
            model="claude-opus-4-7", max_tokens=2000, system=SYSTEM, tools=TOOLS, messages=messages,
        )
        if resp.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": resp.content})
            tool_results = []
            for block in resp.content:
                if getattr(block, "type", None) == "tool_use":
                    try:
                        out = _run_tool(block.name, block.input or {}, db, coach, result)
                    except Exception as exc:
                        out = {"error": str(exc)[:300]}
                    tool_results.append({"type": "tool_result", "tool_use_id": block.id,
                                         "content": json.dumps(out)[:12000]})
            messages.append({"role": "user", "content": tool_results})
            continue
        reply_text = "".join(b.text for b in resp.content if hasattr(b, "text")).strip()
        break

    reply = reply_text
    if not reply:
        # Never show a generic error when we actually have something to offer.
        if result["navigate"]:
            reply = f"Here you go — tap “{result['navigate'].get('label', 'Take me there')}”."
        elif result["pending_action"]:
            reply = "I've set that up — confirm below and I'll run it."
        else:
            reply = ("I couldn't map that one. I can pull your player / team / game data, take you to any "
                     "screen and walk you through how to do things (add a team, import players, track a game, "
                     "run a film eval, build a report packet, share a report…), and create reports. "
                     "Try asking for one of those.")
    return {"reply": reply, "navigate": result["navigate"], "pending_action": result["pending_action"]}


class ConfirmBody(BaseModel):
    action: dict


@router.post("/confirm")
async def confirm(body: ConfirmBody, db: Session = Depends(get_db), coach: models.Coach = Depends(get_current_coach)):
    """Run a generation the coach approved."""
    a = body.action or {}
    kind = a.get("kind")
    if kind == "player_summary":
        p = _find_player(db, coach, a.get("player_id") or a.get("player") or "")
        if not p:
            raise HTTPException(status_code=404, detail="Player not found for the summary.")
        from .players import player_summary as _summary
        from .. import schemas
        months = a.get("months")
        focus = None
        if months:
            focus = f"Focus the summary on the most recent {months} months of evaluations and trajectory."
        req = schemas.SummaryRequest(output_type=a.get("output_type") or "player_eval", focus_prompt=focus)
        res = await _summary(p.id, req, db=db, coach=coach)
        return {"done": True, "message": f"Created a summary for {p.name}.",
                "navigate": {"screen": "player", "params": {"player_id": p.id}, "label": f"Open {p.name}'s profile"}}

    if kind == "scouting_report":
        from .game_eval import _run_scouting
        game = _find_game(db, coach, a.get("game_id"), a.get("opponent_name"))
        if not game:
            raise HTTPException(status_code=404, detail="Couldn't find that game/opponent to scout.")
        await _run_scouting(db, coach, game, [])
        return {"done": True, "message": f"Scouting report ready for vs {game.opponent_name}.",
                "navigate": {"screen": "recent", "label": "Open Recent reports"}}

    if kind == "game_report":
        from .game_eval import _run_game_report
        game = _find_game(db, coach, a.get("game_id"), a.get("opponent_name"))
        if not game:
            raise HTTPException(status_code=404, detail="Couldn't find that game to report on.")
        await _run_game_report(db, coach, game, [])
        return {"done": True, "message": f"Game report ready for vs {game.opponent_name}.",
                "navigate": {"screen": "recent", "label": "Open Recent reports"}}

    if kind == "team_report":
        import os
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured.")
        from .evaluations import _build_team_report_prompt
        from ..coach_context import system_profile_block, resolve_level
        team = db.get(models.Team, a["team_id"]) if a.get("team_id") else None
        if team and team.coach_id != coach.id:
            team = None
        players = db.query(models.Player).filter_by(team_id=team.id).all() if team else _coach_players(db, coach)
        roster_context = ""
        for p in players:
            own = [e for e in p.evaluations if e.coach_id == coach.id]
            latest = own[-1] if own else None
            if latest:
                strengths = ", ".join((latest.green_flags or [])[:2])
                roster_context += f"- {p.name} ({p.position or 'N/A'}): grade {latest.overall_grade}. {strengths}\n"
            else:
                roster_context += f"- {p.name} ({p.position or 'N/A'}): no evaluations yet.\n"
        team_label = team.name if team else coach.program_name
        level = resolve_level(coach, team=team)
        output_type = a.get("output_type") or "coaching_report"
        prompt = _build_team_report_prompt(output_type, team_label, roster_context, "", "",
                                           system_profile_block(coach), level=level)
        import anthropic
        resp = anthropic.Anthropic().messages.create(
            model="claude-opus-4-7", max_tokens=8000, messages=[{"role": "user", "content": prompt}])
        text = "".join(b.text for b in resp.content if hasattr(b, "text"))
        tr = models.TeamReport(coach_id=coach.id, output_type=output_type, report_text=text)
        db.add(tr)
        db.commit()
        return {"done": True, "message": f"Team report ready for {team_label}.",
                "navigate": {"screen": "recent", "label": "Open Recent reports"}}

    raise HTTPException(status_code=400, detail="That action can't be run here yet.")
