"""A player's living projection: who they will be in 4-5 years.

Every player report ends with its own PROJECTION (video_vision/bim/prompts.py,
the three phases). This reads all of them together with everything else on
file — every report, film, tracked games, training, injuries — and keeps one
projection per player on the profile.

The confidence meter is counted, not judged: how many reports, tracked games
and films the projection rests on. More evidence, higher meter. The model
writes what the evidence says; it never sets its own confidence.

Remade on demand, and whenever a new report on the player is saved (the
session hooks at the bottom).
"""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime

from sqlalchemy import event
from sqlalchemy.orm import Session

from . import models

SCALE = ["DOMINANT", "SEPARATES", "ONE-TOOL SEPARATOR", "AT LEVEL", "BEHIND THE LEVEL"]
BUDGET_CHARS = 16000

# What each kind of evidence is worth on the meter, and where it stops adding.
METER = {"reports": (7, 6), "games": (3, 10), "films": (7, 4)}   # points each, cap


def _owner(db: Session, player: models.Player) -> models.Coach | None:
    return db.get(models.Coach, player.coach_id) if player.coach_id else None


def evidence(db: Session, player: models.Player) -> dict:
    """What there is to project from, counted."""
    evals = list(player.evaluations)
    games = 0
    if player.coach_id:
        games = (db.query(models.GamePlayerStat.game_id)
                 .join(models.GameSession, models.GameSession.id == models.GamePlayerStat.game_id)
                 .filter(models.GameSession.coach_id == player.coach_id,
                         models.GamePlayerStat.player_name == player.name,
                         models.GamePlayerStat.is_opponent.is_(False))
                 .distinct().count())
    from . import injuries as inj
    return {
        "reports": len(evals),
        "films": sum(1 for e in evals if e.video_path),
        "games": games,
        "training": db.query(models.TrainingSession).filter_by(player_id=player.id).count(),
        "injuries": len(inj.for_player(db, player)),
    }


def meter(ev: dict) -> dict:
    score = sum(min(ev.get(k, 0), cap) * pts for k, (pts, cap) in METER.items())
    score = min(100, score)
    level = "high" if score >= 70 else "medium" if score >= 35 else "low"
    return {"score": score, "level": level}


def _projection_sections(evals: list[models.Evaluation]) -> str:
    """The PROJECTION each report already wrote, newest first."""
    out = []
    for e in sorted(evals, key=lambda e: e.created_at or datetime.min, reverse=True):
        m = re.search(r"^\s*PROJECTION:\s*$(.*?)(?=^\s*ADDITIONAL FOCUS:|\Z)", e.report_text or "", re.M | re.S)
        if m and m.group(1).strip():
            when = e.created_at.strftime("%Y-%m-%d") if e.created_at else "undated"
            out.append(f"[{when} — {e.output_type}]\n{m.group(1).strip()[:1500]}")
    return "\n\n".join(out[:8])


def _gather(db: Session, coach: models.Coach, player: models.Player) -> str:
    from .player_file import player_file
    from .routes.players import _summary_sources
    from .routes.game_eval import player_tracked_stats_block
    pieces, _ = _summary_sources(db, coach, player, [], None)
    per_doc = max(800, min(5000, BUDGET_CHARS // max(1, len(pieces))))
    reports = "".join(head + (text or "")[:per_doc] + "\n" for head, text in pieces)
    game_ids = [g.id for g in db.query(models.GameSession).filter_by(coach_id=coach.id).all()]
    stats = player_tracked_stats_block(db, coach.id, player.name, game_ids) if game_ids else ""
    return (f"{player_file(db, coach, player, stats=False)}\n\n"
            f"PROJECTIONS THE REPORTS ALREADY MADE:\n{_projection_sections(list(player.evaluations)) or 'none yet'}\n\n"
            f"EVERY REPORT ON FILE (oldest to newest as given):\n{reports or 'none'}\n\n"
            f"{stats}")


def _prompt(player: models.Player, level: str, file_text: str, ev: dict, m: dict,
            previous: dict | None, lang: str) -> str:
    scale = "; ".join(SCALE)
    prev = json.dumps(previous, ensure_ascii=False) if previous else "none — this is the first projection"
    return (
        f"You are the BloomPrint Basketball Intelligence Model. Write the LIVING PROJECTION for "
        f"{player.name}: who this player will be 4-5 years from now, gathered from EVERYTHING on file below.\n\n"
        f"CURRENT LEVEL: {level}\n"
        f"EVIDENCE: {ev['reports']} reports ({ev['films']} from film), {ev['games']} tracked games, "
        f"{ev['training']} training programs, {ev['injuries']} injuries on record. "
        f"Confidence from that evidence: {m['level'].upper()}.\n\n"
        f"Return JSON only:\n"
        "{\"separation\": \"<one of: " + scale + ">\",\n"
        " \"separation_why\": \"<one line: the evidence for it>\",\n"
        " \"level\": \"<the level most likely reached in 4-5 years>\",\n"
        " \"role\": \"<the role there>\",\n"
        " \"best\": \"<best case: level and role>\",\n"
        " \"likely\": \"<likely: level and role>\",\n"
        " \"floor\": \"<floor: level and role>\",\n"
        " \"style_comp\": \"<a real pro who plays the way this player plays, and why>\",\n"
        " \"level_comp\": \"<a real player with a similar profile who reached the projected level, and why>\",\n"
        " \"must_happen\": [\"<the two or three things that decide which outcome>\"],\n"
        " \"confidence_note\": \"<one line: what this rests on and what evidence would raise it>\",\n"
        " \"what_changed\": \"<one line: what is different from the PREVIOUS projection and which new evidence moved it; "
        "empty when there is no previous one>\"}\n\n"
        "Rules:\n"
        "- Separation is judged against the level the player plays at now: DOMINANT = the level is too easy; "
        "SEPARATES = above the level in more than one area; ONE-TOOL SEPARATOR = one tool above the level, the "
        "rest at level; AT LEVEL = competes, doesn't separate yet; BEHIND THE LEVEL = the level is ahead of them.\n"
        "- Work only from the file. Never invent a stat, a measurement, an age or an injury. Account for injuries.\n"
        "- Where the reports' own projections agree, say so through the fields; where they differ, weigh the newer "
        "and better-evidenced one.\n"
        "- Comps must be real players; if you are not sure of one, describe the player type instead of a name.\n"
        "- If the previous projection still holds, keep it and say nothing changed.\n"
        f"- Short, plain lines a coach reads at a glance.{lang}\n\n"
        f"PREVIOUS PROJECTION: {prev}\n\n"
        f"THE FILE:\n{file_text}"
    )


def _clean(d: dict) -> dict | None:
    if not isinstance(d, dict):
        return None
    s = lambda k, n=240: str(d.get(k) or "").strip()[:n]
    sep = s("separation", 40).upper()
    out = {
        "separation": sep if sep in SCALE else "",
        "separation_why": s("separation_why"),
        "level": s("level", 80), "role": s("role", 120),
        "best": s("best"), "likely": s("likely"), "floor": s("floor"),
        "style_comp": s("style_comp"), "level_comp": s("level_comp"),
        "must_happen": [str(x).strip()[:200] for x in (d.get("must_happen") or []) if str(x or "").strip()][:3],
        "confidence_note": s("confidence_note"),
        "what_changed": s("what_changed"),
    }
    return out if (out["likely"] or out["level"]) else None


def _parse(raw: str) -> dict | None:
    m = re.search(r"\{.*\}", raw or "", re.S)
    try:
        return json.loads(m.group(0)) if m else None
    except Exception:
        return None


def _make(player_id: int) -> None:
    """Write the projection (its own session; runs in a thread). Loops while
    another refresh was asked for during the run."""
    import asyncio
    from .ai_models import long_text
    from .coach_context import resolve_level, language_directive
    from .database import SessionLocal
    while True:
        db = SessionLocal()
        try:
            row = db.query(models.PlayerProjection).filter_by(player_id=player_id).first()
            player = db.get(models.Player, player_id)
            coach = _owner(db, player) if player else None
            if row is None or player is None or coach is None:
                return
            row.again = False
            db.commit()
            ev = evidence(db, player)
            m = meter(ev)
            team = db.get(models.Team, player.team_id) if player.team_id else None
            prompt = _prompt(player, resolve_level(coach, player, team), _gather(db, coach, player),
                             ev, m, row.data, language_directive(coach))
        finally:
            db.close()
        data, err = None, None
        try:
            data = _clean(_parse(asyncio.run(long_text(prompt, max_tokens=3000))))
            if data is None:
                err = "The projection came back unreadable."
        except Exception as e:  # noqa: BLE001 — recorded on the row, shown as failed
            err = str(e)[:500]
        db = SessionLocal()
        try:
            row = db.query(models.PlayerProjection).filter_by(player_id=player_id).first()
            if row is None:
                return
            if data:
                if row.data:
                    row.previous = row.data
                else:
                    data["what_changed"] = ""
                row.data, row.evidence, row.status, row.error, row.made_at = data, ev, "ready", None, datetime.utcnow()
            else:
                row.status, row.error = ("ready" if row.data else "failed"), err
            again = row.again
            db.commit()
        finally:
            db.close()
        if not again:
            return


def refresh(db: Session, player: models.Player) -> models.PlayerProjection:
    """Start a new projection, or queue one more if one is being made."""
    row = db.query(models.PlayerProjection).filter_by(player_id=player.id).first()
    if row is None:
        row = models.PlayerProjection(player_id=player.id, status="making")
        db.add(row)
    elif row.status == "making":
        row.again = True
        db.commit()
        return row
    row.status, row.error = "making", None
    db.commit()
    db.refresh(row)
    threading.Thread(target=_make, args=(player.id,), daemon=True).start()
    return row


def has_evidence(ev: dict) -> bool:
    return bool(ev["reports"] or ev["games"])


def out(db: Session, player: models.Player) -> dict:
    row = db.query(models.PlayerProjection).filter_by(player_id=player.id).first()
    ev = evidence(db, player)
    made_from = (row.evidence if row and row.evidence else None)
    return {
        "status": row.status if row else "none",
        "data": row.data if row else None,
        "error": row.error if row else None,
        "made_at": row.made_at.isoformat() + "Z" if row and row.made_at else None,
        # The meter shows what the projection was made from; `now` is what is
        # on file today, so the card can say there is newer evidence.
        "evidence": made_from or ev,
        "meter": meter(made_from or ev),
        "now": ev,
        "can_make": has_evidence(ev),
        "newer": bool(made_from) and any(ev.get(k, 0) > made_from.get(k, 0) for k in ("reports", "games", "films")),
    }


# ── A new report on a player remakes the projection ───────────────────────────

_KEY = "projection_players"


def _after_flush(session, _ctx):
    for obj in session.new:
        if isinstance(obj, models.Evaluation) and obj.player_id:
            session.info.setdefault(_KEY, set()).add(obj.player_id)


def _after_commit(session):
    ids = session.info.pop(_KEY, None)
    if not ids or not os.environ.get("ANTHROPIC_API_KEY"):
        return
    from .database import SessionLocal

    def go():
        db = SessionLocal()
        try:
            for pid in ids:
                p = db.get(models.Player, pid)
                if p is not None and not getattr(p, "deleted_at", None):
                    refresh(db, p)
        finally:
            db.close()
    # Not inside the committing session's own commit.
    threading.Thread(target=go, daemon=True).start()


def _after_rollback(session):
    session.info.pop(_KEY, None)


def install() -> None:
    if getattr(install, "_done", False):
        return
    event.listen(Session, "after_flush", _after_flush)
    event.listen(Session, "after_commit", _after_commit)
    event.listen(Session, "after_soft_rollback", lambda s, _t: _after_rollback(s))
    install._done = True
