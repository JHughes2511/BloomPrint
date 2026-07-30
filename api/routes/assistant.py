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


def t_search_staff(db, coach, query: str = "") -> dict:
    q = (query or "").strip()
    rows = (
        db.query(models.Coach)
        .filter((models.Coach.name.ilike(f"%{q}%")) | (models.Coach.program_name.ilike(f"%{q}%")))
        .filter(models.Coach.id != coach.id)
        .limit(15).all()
    )
    return {"staff": [{"id": c.id, "name": c.name, "role": c.role, "program": c.program_name} for c in rows]}


def t_list_conversations(db, coach) -> dict:
    my = [m.conversation_id for m in db.query(models.ConversationMember).filter_by(coach_id=coach.id).all()]
    out = []
    for conv in db.query(models.Conversation).filter(models.Conversation.id.in_(my)).order_by(models.Conversation.last_at.desc()).limit(20).all() if my else []:
        member_ids = [m.coach_id for m in db.query(models.ConversationMember).filter_by(conversation_id=conv.id).all()]
        names = {c.id: c.name for c in db.query(models.Coach).filter(models.Coach.id.in_(member_ids)).all()}
        last = db.query(models.StaffMessage).filter_by(conversation_id=conv.id).order_by(models.StaffMessage.id.desc()).first()
        out.append({
            "id": conv.id, "is_group": bool(conv.is_group),
            "title": conv.title or ", ".join(names[i] for i in member_ids if i != coach.id and i in names) or "Conversation",
            "last_message": (last.text or "[attachment]")[:120] if last else None,
        })
    return {"conversations": out}


def t_list_shared_with_me(db, coach) -> dict:
    """Reports shared with this coach, identified the way a human would: subject
    name, report type, sender, and date (ids kept only so other tools can fetch
    the text — never show them to the coach)."""
    from .staff_sharing import _report_meta
    out = []
    for sr in db.query(models.StaffSharedReport).filter_by(recipient_id=coach.id).order_by(models.StaffSharedReport.id.desc()).limit(25).all():
        sender = db.get(models.Coach, sr.sender_id)
        try:
            subject, otype, grade = _report_meta(sr.report_type, sr.report_id, db)
        except Exception:
            subject, otype, grade = None, None, None
        out.append({
            "share_id": sr.id,
            "subject": subject or "Report",
            "report_kind": otype or sr.report_type,
            "from": sender.name if sender else "A coach",
            "date": sr.created_at.strftime("%Y-%m-%d") if sr.created_at else None,
            "grade": grade,
            "allow_regenerate": bool(sr.allow_regenerate),
        })
    return {"shared_with_me": out,
            "note": "Identify these to the coach by subject + report_kind + from + date. NEVER show ids. "
                    "Use get_shared_report_text(share_id) to read one and say what it's about."}


def t_get_shared_report_text(db, coach, share_id: int) -> dict:
    """Full text of a report SHARED WITH this coach (frozen snapshot, the
    recipient's regenerated copy, or the live underlying report)."""
    from .staff_sharing import _resolve_report_text, _report_meta
    sr = db.get(models.StaffSharedReport, int(share_id))
    if not sr or sr.recipient_id != coach.id:
        return {"error": "Shared report not found."}
    text = sr.regenerated_text or sr.frozen_text or _resolve_report_text(sr.report_type, sr.report_id, db, sr.sender_id)
    try:
        subject, otype, _g = _report_meta(sr.report_type, sr.report_id, db)
    except Exception:
        subject, otype = None, None
    sender = db.get(models.Coach, sr.sender_id)
    return {"subject": subject, "report_kind": otype or sr.report_type,
            "from": sender.name if sender else "A coach",
            "date": sr.created_at.strftime("%Y-%m-%d") if sr.created_at else None,
            "text": (text or "")[:6000] or "No text available for this share."}


def t_get_conversation_messages(db, coach, conversation_id: int = 0, with_name: str = "") -> dict:
    """Recent messages in one staff conversation (both directions), so questions
    like 'what was the last message from Mike' are answerable."""
    conv = None
    my = [m.conversation_id for m in db.query(models.ConversationMember).filter_by(coach_id=coach.id).all()]
    if conversation_id:
        conv = db.get(models.Conversation, int(conversation_id))
        if not conv or conv.id not in my:
            return {"error": "Conversation not found."}
    elif with_name.strip():
        wn = with_name.strip().lower()
        newest = None
        for cid_ in my:
            member_ids = [m.coach_id for m in db.query(models.ConversationMember).filter_by(conversation_id=cid_).all()]
            others = db.query(models.Coach).filter(models.Coach.id.in_([i for i in member_ids if i != coach.id])).all()
            if any(wn in (c.name or "").lower() for c in others):
                c = db.get(models.Conversation, cid_)
                if c and (newest is None or (c.last_at or datetime.min) > (newest.last_at or datetime.min)):
                    newest = c
        conv = newest
        if not conv:
            return {"error": f"No conversation found with '{with_name}'."}
    else:
        return {"error": "Give a conversation_id or with_name."}
    member_ids = [m.coach_id for m in db.query(models.ConversationMember).filter_by(conversation_id=conv.id).all()]
    names = {c.id: c.name for c in db.query(models.Coach).filter(models.Coach.id.in_(member_ids)).all()}
    msgs = (db.query(models.StaffMessage).filter_by(conversation_id=conv.id)
            .order_by(models.StaffMessage.id.desc()).limit(15).all())
    return {
        "conversation_id": conv.id,
        "with": [names.get(i, "Staff") for i in member_ids if i != coach.id],
        "messages": [{
            "from": "me" if m.sender_id == coach.id else names.get(m.sender_id, "Staff"),
            "text": (m.text or "[attachment]")[:400],
            "date": m.created_at.strftime("%Y-%m-%d %H:%M") if m.created_at else None,
        } for m in reversed(msgs)],
    }


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
    {"name": "search_staff", "description": "Search other coach/scout/trainer ACCOUNTS by name or program (for messaging or sharing). Returns their ids.",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "list_conversations", "description": "The coach's staff-message conversations (1:1 and group) with the last message.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "list_shared_with_me", "description": "Reports other coaches shared with this coach (the staff-sharing inbox), with subject name, report kind, sender, and date.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "get_shared_report_text", "description": "Read the full text of a report someone SHARED with this coach (use the share_id from list_shared_with_me) so you can say what it's about or answer questions on it.",
     "input_schema": {"type": "object", "properties": {"share_id": {"type": "integer"}}, "required": ["share_id"]}},
    {"name": "get_conversation_messages", "description": "Recent staff messages in one conversation (both directions, with sender + date). Pass conversation_id from list_conversations, OR just with_name (e.g. 'Mike') to find the chat with that person.",
     "input_schema": {"type": "object", "properties": {"conversation_id": {"type": "integer"}, "with_name": {"type": "string"}}}},
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
        "- 'team_grade' — Team Grade SEASON DASHBOARD (record, avg grade, trend, leaderboard).\n"
        "- 'games' — Team Grade GAMES LIST.\n"
        "- 'track_game' / 'new_game' — opens the NEW GAME form directly (opponent, team, level, date, "
        "Live Track vs Post-Game). Use for 'track a game' AND 'import a box score after a game'.\n"
        "- 'game_detail' — one tracked game's detail (params: game_id).\n"
        "- 'scout' — opens the SCOUT view directly (opponent scouting).\n"
        "- 'game_report_view' — opens the per-game GAME REPORT view.\n"
        "- 'whiteboard' — opens the whiteboard PLAYBOOK directly.\n"
        "- 'staff_inbox' — the Staff Hub: reports other coaches shared with you, staff teams/games, AND "
        "MESSAGES (conversations with other staff — coaches CAN message each other here). Use for "
        "'message a coach', 'send Mike a message', staff chat, joining/creating teams and sub-teams, "
        "inviting staff.\n"
        "- 'conversation' — one specific staff conversation (params: conversation_id from "
        "list_conversations).\n"
        "- 'notifications' — coach notifications.\n"
        "- 'edit_profile' — opens the EDIT PROFILE modal directly (name, role, program, COMPETITION "
        "LEVEL, philosophy). Use for any profile/level/philosophy change.\n"
        "- 'feedback' — opens the FEEDBACK form directly.\n"
        "Do NOT invent other screen names. These land on the EXACT view/modal — say 'this button opens "
        "it right there', not 'then find X'."),
     "input_schema": {"type": "object", "properties": {"screen": {"type": "string"}, "player_id": {"type": "integer"}, "eval_id": {"type": "integer"}, "report_id": {"type": "integer"}, "game_id": {"type": "integer"}, "conversation_id": {"type": "integer"}, "share": {"type": "string", "enum": ["player", "staff"], "description": "for eval_report: open Send-to-Player or Share-with-Staff"}, "label": {"type": "string", "description": "button text"}}, "required": ["screen", "label"]}},
    {"name": "propose_generation", "description": (
        "Propose an ACTION the coach must confirm before it runs. Do NOT run it yourself. Supported kinds:\n"
        "- 'player_summary' (args: player_id REQUIRED, months optional, output_type optional) — a report "
        "synthesized from a player's eval history. For a RECRUITING/SCOUTING report on the coach's own "
        "player (to send to a scout / evaluate potential), use this kind with output_type='scouting_report'.\n"
        "- 'player_matchup' (args: player_id REQUIRED, matchup_player_ids REQUIRED comma-separated ids) — "
        "a MATCH UP report comparing two or more of the coach's players head-to-head from everything on "
        "file (evals, tracked stats, mentions in other reports). Look up every player_id first.\n"
        "- 'team_report' (args: team_id optional) — a report across a team's roster.\n"
        "- 'scouting_report' (args: game_id OR opponent_name) — PRE-GAME OPPONENT scouting only.\n"
        "- 'game_report' (args: game_id OR opponent_name) — our-team + opponent game report.\n"
        "- 'send_staff_message' (args: recipient_ids REQUIRED comma-separated ids from search_staff, "
        "text REQUIRED) — send a staff message. ONE id = direct 1:1; TWO OR MORE ids = creates/reuses a "
        "GROUP chat with all of them and sends there.\n"
        "For player generations, pass the exact player_id you confirmed via player_detail. Anything "
        "needing NEW film is NOT supported — use suggest_navigation to 'new_eval'. Always include a short "
        "human description that names the exact player/team/opponent/recipient (and for a message, quote "
        "the text you will send)."),
     "input_schema": {"type": "object", "properties": {"kind": {"type": "string"}, "player_id": {"type": "integer"}, "matchup_player_ids": {"type": "string"}, "team_id": {"type": "integer"}, "game_id": {"type": "integer"}, "opponent_name": {"type": "string"}, "months": {"type": "integer"}, "output_type": {"type": "string"}, "recipient_ids": {"type": "string", "description": "comma-separated coach ids; 2+ = group chat"}, "recipient_id": {"type": "integer"}, "text": {"type": "string"}, "description": {"type": "string"}}, "required": ["kind", "description"]}},
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
    if name == "search_staff":
        return t_search_staff(db, coach, args.get("query", ""))
    if name == "list_conversations":
        return t_list_conversations(db, coach)
    if name == "list_shared_with_me":
        return t_list_shared_with_me(db, coach)
    if name == "get_shared_report_text":
        return t_get_shared_report_text(db, coach, args.get("share_id", 0))
    if name == "get_conversation_messages":
        return t_get_conversation_messages(db, coach, args.get("conversation_id", 0), args.get("with_name", ""))
    if name == "suggest_navigation":
        result["navigate"] = {"screen": args.get("screen"), "label": args.get("label", "Take me there"),
                              "params": {k: args[k] for k in ("player_id", "eval_id", "report_id", "game_id", "conversation_id", "share") if args.get(k) is not None}}
        return {"ok": "Navigation button shown to the user."}
    if name == "propose_generation":
        result["pending_action"] = {k: v for k, v in args.items() if v is not None}
        return {"ok": "Confirmation prompt shown; it will run only after the coach approves."}
    return {"error": f"Unknown tool {name}"}


SYSTEM = (
    "You are Ask BloomPrint, the in-app assistant for a basketball COACH using BloomPrint. You can "
    "ANSWER with the coach's real data, GUIDE them to any screen with step-by-step how-tos, and EXECUTE "
    "actions (confirm-first): create reports, generate match-ups, send staff messages. You know the whole "
    "app — NEVER say you can't do something the app can do. Your decision order for ANY request: "
    "(1) can I answer it from data with my read tools? (2) can I execute it via propose_generation? "
    "(3) otherwise give the exact step-by-step how-to AND a 'Take me there' navigation button. A flat "
    "refusal is only correct for things truly outside the app (and even then, offer the closest thing).\n\n"

    "WHAT BLOOMPRINT IS: it runs the Basketball Intelligence Model (BIM), grading players 0–10 across six "
    "pillars — Offensive Skills, Defensive, Physical, Intangibles, Advanced, Strategic Fit — always "
    "calibrated to the player's/team's COMPETITION LEVEL. A player's composite BIM grade is a "
    "recency-weighted blend of all their evals.\n\n"

    "YOUR DATA ACCESS is live and scoped to THIS coach only. Use the read tools to answer with real "
    "numbers — never invent players, games, grades, or reports. If it isn't there, say so.\n\n"

    "SPEAK LIKE A HUMAN ABOUT REPORTS & MESSAGES — this rule applies to EVERYTHING you say:\n"
    "- NEVER show internal ids (share id, report id, eval id, conversation id) to the coach. Ids are for "
    "your tool calls only. Identify every report by SUBJECT NAME + REPORT TYPE + DATE (e.g. \"Ashten "
    "Bloom's Player Eval from Jamie, Jul 11\"), and every conversation by WHO it's with.\n"
    "- When several reports would read the same (same subject, same type), DISAMBIGUATE with the date, "
    "grade, or a one-line gist — never print an identical line twice or collapse them into '×5'.\n"
    "- When the coach asks WHAT a report says or is about, don't stop at metadata: READ it "
    "(get_report_text for their own, get_shared_report_text for shares) and give a 2–3 sentence gist. "
    "Never say you can't pull the text of a shared report — you can.\n"
    "- When the coach asks about messages ('what did Mike say', 'what was the last message'), use "
    "get_conversation_messages and quote the actual last messages with who sent them and when.\n\n"

    "REPORT TYPES (usable alone or COMBINED into one comprehensive report by multi-selecting): "
    "Player Eval, Film Breakdown, Scouting Report, Coaching Report, Game Analysis, Box Score, Training "
    "Program, Recruitment Profile, Position Analysis, Game Situational, and MATCH UP (head-to-head "
    "comparison — players vs players in New Eval, teams vs teams in the Game Report Builder; compares "
    "as-is and flags competition-level/confidence gaps).\n\n"

    "THE APP MAP (5 bottom tabs):\n"
    "- HOME — dashboard + report-type shortcuts, the 6 pillars, the Ask BloomPrint bar (you), and a "
    "FEEDBACK tile (send app feedback). Top-right icons: light/dark THEME toggle, Edit Profile (user "
    "icon → name, role, program, COMPETITION LEVEL, country/city, Sign Out, and Program System & "
    "Philosophy — 6 philosophy fields, importable from any document, feeding every AI generation), Staff "
    "Inbox (mail), Notifications (bell, unread badge).\n"
    "- ROSTER — all players and teams. Search; add a player (+ top-right: name required, team, position, "
    "jersey, height/wingspan/weight/reach, school, level, parent permission); create a team ('New Team' "
    "chip); long-press a team to rename/delete; long-press a player to delete; Import Roster (AI reads "
    "ANY file); tap a player → their profile: composite BIM score, pillar grades, flags, eval history, "
    "training history, game history, FILM CATALOG, edit player, New Eval, Summarize Evaluation History, "
    "Generate Training Program, send/share training, Generate Player Invite Code (code + QR to link the "
    "player's own account).\n"
    "- TEAM EVAL — team-level reports: Quick Report (pick team, report type(s), focus, optional film → "
    "Generate), Game Report PACKETS (the Game Report Builder), Previous Reports (search/filter, open, "
    "correct & regenerate), and the team FILM CATALOG of all packet clips.\n"
    "- TEAM GRADE — game tracking & season intel. Views: Dashboard (season record, avg team grade, "
    "grade-trend chart, phase filters), Games (New Game: opponent, team, level, date, phase, LIVE track "
    "or POST-GAME box-score import), Live tracker (score bar, game clock with periods, 24 offense/defense "
    "stat buttons per player, opponent roster, lineups/subs, End Game), Game Detail (per-player + "
    "by-quarter grades, edit stats, Export PDF/CSV, Share with Staff, Generate Game Report), Scout "
    "(opponent scouting reports + remembered opponent notes), Game Report (full our-team + opponent "
    "report). A floating court button opens the WHITEBOARD anywhere here (game boards + a persistent "
    "PLAYBOOK).\n"
    "- RECENT — every saved report in one feed: evals, team reports, packet versions, scouting, game "
    "reports, training, MATCH UPS (own filter pill), plus reports shared with you. Search, filter, open, "
    "correct & regenerate, delete (long-press), Send to Player, Share, Export/Print per card.\n\n"

    "HOW-TO PLAYBOOK — when the coach asks 'how do I …' / 'where do I …', give the FULL step sequence AND "
    "you MUST ALWAYS call suggest_navigation in the same turn — a how-to answer WITHOUT a 'Take me "
    "there' button is a broken answer, no exceptions (yes, even for profile/settings changes):\n"
    "- ADD A TEAM → 'add_team' (Roster): tap 'New Team', name it, pick level, Create. (Also possible "
    "inside New Game, and in Staff Hub → My Teams.)\n"
    "- ADD A PLAYER → 'add_player' (Roster): tap +, Full Name required, team, position, jersey, "
    "measurements, level, parent permission, Add.\n"
    "- IMPORT PLAYERS → 'import': pick/create a team, pick ANY file (Excel/CSV/PDF/Word/photo), Analyze "
    "File, toggle the players you want, Import.\n"
    "- TRACK A GAME (live) → 'track_game' (Team Grade → Games → New Game → Live Track): tap a player, "
    "tap stat buttons as the game runs; game clock auto-advances periods; End Game when done.\n"
    "- TRACK A GAME (post-game) → 'track_game': New Game → Post-Game → 'Import Box Score (.xlsx)' → "
    "preview → commit (your team AND/OR the opponent).\n"
    "- RUN A NEW FILM EVAL → 'new_eval' (player_id): pick report type(s), attach film clip(s) and/or "
    "select tracked games for Box Score, add notes/focus (typed, dictated, or imported from a doc), Run "
    "BIM Analysis.\n"
    "- PLAYER MATCH-UP (compare players) → EITHER offer to create it right here (see EXECUTE: "
    "'player_matchup') OR 'new_eval': select the base player, tap the Match Up type, pick the players to "
    "compare against, Run. It lands in Recent under the Match Ups pill titled 'A vs B'.\n"
    "- TEAM MATCH-UP (compare teams, 2 or MORE) → 'game_report_builder': pick the Match Up report type, "
    "set the two sides (saved teams or typed names), and use 'Additional Teams' to add a 3rd+; Generate.\n"
    "- SUMMARIZE a player's eval history → open 'player' → 'Summarize Evaluation History' (or offer to "
    "create it — see EXECUTE: 'player_summary').\n"
    "- TRAINING PROGRAM → 'training' (player_id): add focus (or import a reference doc), Generate. From "
    "the player profile you can then Send to Player, Share with Staff, print/export, and later "
    "'Update Program with Feedback'; sent programs get a comment thread with the player.\n"
    "- TEAM REPORT (Quick Report) → 'team_eval': pick team, report type(s), focus, optional film, "
    "Generate.\n"
    "- GAME REPORT PACKET → 'game_report_builder': name it, pick context mode (My Program vs Opponent / "
    "My Program / Opponent Only / Opponent vs Opponent), teams (saved or typed — NO tracked game "
    "required), report type(s), attach film clips (labeled My Team/Opponent, AI-broken-down, "
    "correctable), box score + scouting notes (typed or imported), Generate. Each report-type selection "
    "saves its own VERSION inside the packet.\n"
    "- OPPONENT SCOUTING → 'scout' (Team Grade → Scout): pick the opponent → generate/apply corrections; "
    "'Remember for {opponent}' saves notes that persist across games and feed future reports.\n"
    "- WHITEBOARD / PLAYS → 'whiteboard' (Team Grade, floating court button): draw (pen, shapes, solid/"
    "dashed pass arrows, text), or AI 'Draw It Up' from a description (optionally seeded from a scout/"
    "team report, with per-position intents) → Offense/Defense/Counter schemes + a Key of suggestions; "
    "drag players/arrows then 'Adapt play' to re-solve; 'Refine' with free text; 'Play' animates the "
    "scheme; 'Play drawing' replays hand-drawn marks in draw order; boards persist (game boards + "
    "standalone PLAYBOOK; new/duplicate/delete boards).\n"
    "- EDIT PROFILE / COMPETITION LEVEL / PHILOSOPHY → 'edit_profile' (Home, top-right user icon). "
    "Philosophy can be imported from a PDF/Word/photo and is used by every future generation.\n"
    "- SWITCH LIGHT/DARK THEME → Home top-right sun/moon icon.\n"
    "- SEND APP FEEDBACK → 'feedback' (Home): tap the Feedback tile, type or dictate, Submit.\n"
    "- LINK A PLAYER'S ACCOUNT → open 'player' → 'Generate Player Invite Code' → share code/QR. Players "
    "can also send link requests you approve in Notifications. Linked players get shared reports in "
    "their own app, see only what you toggle on, can comment, track training progress, and generate "
    "their own training from a shared report.\n"
    "- FIND FILM → player clips: 'player' → Film Catalog; team/packet clips: 'team_eval' → Film Catalog.\n"
    "- MESSAGE ANOTHER COACH / STAFF (1:1 OR GROUP) → I can SEND IT from here, including CREATING A "
    "GROUP CHAT (see EXECUTE: 'send_staff_message' — pass 2+ recipient_ids for a group). Or manually: "
    "'staff_inbox' → Messages → New → pick staff (multi-select = group chat) → type/dictate. "
    "Conversations support image attachments, voice messages, and attaching any report. NEVER say "
    "coach-to-coach messaging or group chats aren't supported — both are, and you can send them "
    "yourself.\n"
    "- JOIN / BUILD A STAFF → 'staff_inbox' → My Teams: search & join any team, create teams and "
    "SUB-TEAMS, invite a coach by name or email, message the whole team group, leave a team. Staff on a "
    "team see its games under Team Games.\n"
    "- CORRECT ANY REPORT → open the report → Correct → type the correction → Save for later or Apply & "
    "Regenerate. Works on evals, team reports, packets, scouting, game reports, training, and reports "
    "shared with you (if the sharer allowed regeneration — your edits save as your own 'Updated' copy; "
    "you can also ADOPT a shared eval as your own).\n"
    "- EXPORT / PRINT → every report card and viewer has Export PDF / Print, with per-section include "
    "toggles.\n"
    "- VOICE INPUT → every text box has a mic button; tap it and dictate.\n\n"

    "EXECUTE (confirm-first) — call propose_generation; NEVER run it directly; the coach approves first. "
    "Before ANY player action, call player_detail/search_players for the EXACT player_id — never guess. "
    "Kinds: 'player_summary' (player_id; months, output_type optional — use "
    "output_type='scouting_report' for recruiting/scouting the coach's OWN player; never refuse that), "
    "'player_matchup' (player_id + matchup_player_ids — compare 2+ of the coach's players from all data "
    "on file), 'team_report' (team_id optional), 'scouting_report' (game_id OR opponent_name; PRE-GAME "
    "opponent scouting), 'game_report' (game_id OR opponent_name; needs a tracked game — otherwise send "
    "them to 'game_report_builder'), 'send_staff_message' (recipient_ids from search_staff + text; "
    "1 id = direct message, 2+ ids = GROUP chat — when asked to message a group, propose ONE "
    "send_staff_message carrying all the ids; never offer separate 1:1s instead). "
    "Things that need FILM or builder UI are NOT proposable — navigate instead ('new_eval', 'training', "
    "'game_report_builder').\n\n"

    "SEND / SHARE REPORTS — fully supported; never say otherwise. Every saved report can be: SENT TO A "
    "PLAYER (their inbox; linked account required; content toggles; consent flow if the report is about "
    "a different player), SHARED WITH STAFF (individual coach, a whole team, or a whole program; choose "
    "sections; 'allow regenerate' = live copy vs frozen snapshot), shared into a TEAM (players + staff), "
    "attached inside a staff MESSAGE, or FORWARDED. When the coach wants to send/share an eval: locate "
    "it (player_detail / list_reports), or create it first, then suggest_navigation to 'eval_report' "
    "with that eval_id and share='staff' or share='player' to open the share sheet.\n\n"

    "PLAYER-SIDE APP (what linked players see, if the coach asks): their BIM score + pillars (from "
    "shared evals only), reports you shared (only the sections you toggled), training programs with "
    "drill checklists + progress bars, comment threads with you, 'update with feedback' regeneration, "
    "PDF export, and notifications. Consent: sharing a player's report with a DIFFERENT player asks the "
    "subject's approval first.\n\n"

    "IF YOU TRULY CAN'T map a request: never a flat refusal. Say what you CAN do (pull data, execute "
    "confirm-first actions, take them anywhere with steps) and offer the closest option.\n\n"

    "STYLE: plain text, lead with the answer, ALL-CAPS section titles and '- ' bullets when listing "
    "steps, tight and coach-facing."
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

    # Answer in the coach's chosen language (UI + reports follow the same choice).
    from ..coach_context import LANGUAGE_NAMES
    _lang = (getattr(coach, "preferred_language", None) or "en").strip().lower()
    system = SYSTEM
    if _lang not in ("", "en"):
        system = SYSTEM + (
            f"\n\nREPLY LANGUAGE: The coach uses the app in {LANGUAGE_NAMES.get(_lang, _lang)}. "
            "Write ALL replies (including section titles, steps, and button labels you reference) "
            "in that language; keep player/team names and stat abbreviations as-is."
        )

    result = {"navigate": None, "pending_action": None}
    reply_text = ""
    for _ in range(6):  # bounded tool-use loop
        resp = client.messages.create(
            model="claude-opus-4-7", max_tokens=2000, system=system, tools=TOOLS, messages=messages,
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
    if not reply and (result["navigate"] or result["pending_action"]):
        # The model ended on a tool call with no prose. Ask it once more, without
        # tools, to actually write the coach-facing answer (steps included) —
        # a bare button with no explanation is not an acceptable reply.
        try:
            follow = client.messages.create(
                model="claude-opus-4-7", max_tokens=1000, system=system,
                messages=messages + [{"role": "user", "content":
                    "Write your reply to the coach now (no tool calls): lead with the answer and, if you "
                    "showed a navigation button, spell out the exact steps they'll take on that screen."}],
            )
            reply = "".join(b.text for b in follow.content if hasattr(b, "text")).strip()
        except Exception:
            reply = ""
    if not reply:
        # Never show a generic error when we actually have something to offer.
        if result["navigate"]:
            reply = f"Here you go — tap “{result['navigate'].get('label', 'Take me there')}”."
        elif result["pending_action"]:
            reply = "I've set that up — confirm below and I'll run it."
        else:
            reply = ("I couldn't map that one. I can pull your player / team / game data, take you to any "
                     "screen and walk you through how to do things (add a team, import players, track a game, "
                     "run a film eval, build a report packet, share a report…), create reports and match-ups, "
                     "and send staff messages. Try asking for one of those.")
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
        await _summary(p.id, req, db=db, coach=coach)
        # The summary is saved as an Evaluation — open THAT report, not the profile.
        ev = (db.query(models.Evaluation).filter_by(coach_id=coach.id, player_id=p.id)
              .order_by(models.Evaluation.id.desc()).first())
        if ev:
            return {"done": True, "message": f"Report ready for {p.name}.",
                    "navigate": {"screen": "eval_report", "params": {"eval_id": ev.id},
                                 "label": f"Open {p.name}'s report"}}
        return {"done": True, "message": f"Created a summary for {p.name}.",
                "navigate": {"screen": "player", "params": {"player_id": p.id}, "label": f"Open {p.name}'s profile"}}

    if kind == "player_matchup":
        import os
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured.")
        base = _find_player(db, coach, a.get("player_id") or "")
        if not base:
            raise HTTPException(status_code=404, detail="Base player not found for the match-up.")
        ids = [int(x) for x in str(a.get("matchup_player_ids") or "").split(",") if str(x).strip().isdigit()]
        others = [p for p in (_find_player(db, coach, i) for i in ids) if p and p.id != base.id]
        if not others:
            raise HTTPException(status_code=404, detail="No valid players to compare against were found.")
        subjects = [base] + others
        names = " vs ".join(p.name for p in subjects)
        from .evaluations import _gather_player_dossier, _finalize_eval
        from ..coach_context import resolve_level, system_profile_block
        from video_vision.bim import build_prompt, additional_focus_directive
        dossiers = "\n\n".join(_gather_player_dossier(db, coach, p) for p in subjects)
        combined_focus = (
            system_profile_block(coach)
            + f"\n\nMATCH-UP SUBJECTS — {names}. Compare these subjects head-to-head using ONLY the data "
            "below. Compare them AS THEY ARE (do not normalize across competition levels); flag any level "
            "gap and, if a subject's data is thin, note the confidence gap.\n\n" + dossiers
        )
        level = resolve_level(coach, base, db.get(models.Team, base.team_id) if base.team_id else None)
        prompt = build_prompt("matchup", coach.program_name, level, coach.weight, base.name)
        prompt += additional_focus_directive(combined_focus)
        import anthropic
        resp = anthropic.Anthropic().messages.create(
            model="claude-opus-4-7", max_tokens=16000, messages=[{"role": "user", "content": prompt}])
        text = "".join(b.text for b in resp.content if hasattr(b, "text"))
        ev = _finalize_eval(db, player_id=base.id, coach=coach, output_type="matchup",
                            competition_level=level, coach_notes=None, video_path=None,
                            report_text=text, title=names)
        return {"done": True, "message": f"Match Up ready: {names}.",
                "navigate": {"screen": "eval_report", "params": {"eval_id": ev.id}, "label": "Open the Match Up"}}

    if kind == "send_staff_message":
        raw_ids = str(a.get("recipient_ids") or a.get("recipient_id") or "")
        rids = sorted({int(x) for x in raw_ids.split(",") if x.strip().isdigit()} - {coach.id})
        text = (a.get("text") or "").strip()
        if not rids or not text:
            raise HTTPException(status_code=400, detail="At least one recipient and message text are required.")
        others = [c for c in (db.get(models.Coach, i) for i in rids) if c]
        if not others:
            raise HTTPException(status_code=404, detail="Those staff members weren't found.")
        is_group = len(others) > 1
        want = {coach.id, *(c.id for c in others)}
        # Reuse an existing conversation with EXACTLY these members, else create
        # one (same logic as the Messages screen; groups match on full member set).
        mine = {m.conversation_id for m in db.query(models.ConversationMember).filter_by(coach_id=coach.id).all()}
        conv = None
        for cid_ in mine:
            c = db.get(models.Conversation, cid_)
            if not c or bool(c.is_group) != is_group:
                continue
            members = {m.coach_id for m in db.query(models.ConversationMember).filter_by(conversation_id=cid_).all()}
            if members == want:
                conv = c
                break
        if not conv:
            conv = models.Conversation(is_group=is_group, created_by=coach.id)
            db.add(conv)
            db.flush()
            for cid_ in want:
                db.add(models.ConversationMember(conversation_id=conv.id, coach_id=cid_))
        msg = models.StaffMessage(conversation_id=conv.id, sender_id=coach.id, text=text)
        db.add(msg)
        conv.last_at = datetime.utcnow()
        for c in others:
            db.add(models.PlayerNotification(
                coach_id=c.id, type="staff_message",
                title=f"Message from {coach.name}", body=text[:120],
                i18n_key="notifs.staffMessage",
                i18n_params={"coach": coach.name, "preview": text[:120]},
                ref_id=conv.id))
        db.commit()
        names = ", ".join(c.name for c in others)
        return {"done": True,
                "message": f"Message sent to the group with {names}." if is_group else f"Message sent to {names}.",
                "navigate": {"screen": "conversation", "params": {"conversation_id": conv.id},
                             "label": "Open the group chat" if is_group else f"Open chat with {names}"}}

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
