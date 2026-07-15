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
    {"name": "suggest_navigation", "description": "Show the coach a 'Take me there' button that opens a screen. Use for 'where is X' / 'how do I Y'. Valid screens: home, roster, player (params: player_id), eval_report (params: eval_id), team_grade, team_eval, recent, new_eval (params: player_id), game_report_builder (params: report_id), import, training (params: player_id).",
     "input_schema": {"type": "object", "properties": {"screen": {"type": "string"}, "player_id": {"type": "integer"}, "eval_id": {"type": "integer"}, "report_id": {"type": "integer"}, "label": {"type": "string", "description": "button text"}}, "required": ["screen", "label"]}},
    {"name": "propose_generation", "description": "Propose creating a NEW report the coach must confirm before it runs. Do NOT run generation yourself. kind: 'player_summary' (args: player_id, months optional) or 'team_report' (args: team_id optional). Always include a short human description.",
     "input_schema": {"type": "object", "properties": {"kind": {"type": "string"}, "player_id": {"type": "integer"}, "team_id": {"type": "integer"}, "months": {"type": "integer"}, "output_type": {"type": "string"}, "description": {"type": "string"}}, "required": ["kind", "description"]}},
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
                              "params": {k: args[k] for k in ("player_id", "eval_id", "report_id") if args.get(k) is not None}}
        return {"ok": "Navigation button shown to the user."}
    if name == "propose_generation":
        result["pending_action"] = {k: v for k, v in args.items() if v is not None}
        return {"ok": "Confirmation prompt shown; it will run only after the coach approves."}
    return {"error": f"Unknown tool {name}"}


SYSTEM = (
    "You are BloomPrint Copilot, an in-app assistant for a basketball coach. You have live, "
    "read access to THIS coach's own data (players, evaluations, tracked games and stats, season "
    "dashboard, opponents, saved reports, plays/whiteboards, training) via tools — use them to "
    "answer with real numbers, never guess. Be concise and coach-friendly; lead with the answer.\n\n"
    "Capabilities:\n"
    "- Answer & analyze questions from the data (who's developing, which opponents we struggled "
    "with, a player's trajectory, etc.). Call the read tools, then synthesize.\n"
    "- Locate things and guide: for 'where is my ... report' or 'how do I ...', find it with the "
    "read tools if needed, then call suggest_navigation so the app shows a 'Take me there' button, "
    "and give a one-line how-to.\n"
    "- Create things: if the coach asks you to CREATE a report/summary, call propose_generation "
    "with a clear description — NEVER generate directly; the coach confirms first. Anything needing "
    "NEW film (a fresh video eval) can't be done here — instead suggest_navigation to 'new_eval'.\n\n"
    "Format replies in plain text with ALL-CAPS section titles and '- ' bullets when listing. Keep "
    "it tight."
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

    return {"reply": reply_text or "I couldn't work that out — try rephrasing.",
            "navigate": result["navigate"], "pending_action": result["pending_action"]}


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
    raise HTTPException(status_code=400, detail="That action can't be run here yet.")
