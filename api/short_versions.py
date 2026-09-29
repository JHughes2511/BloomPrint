"""Short versions of reports: the one page a staff prints and hands out.

A short version is made FROM the standard report — the same facts, cut down
to what can be read at a glance. It is made on demand: the first time someone
opens Short, then kept. When the standard text changes it is made again the
next time it is opened — unless the coach has edited or corrected it, in which
case their version stays and the page offers to remake it from the standard
(ShortVersion.source_hash, .edited).

Every report kind plugs in with two things: where its text lives
(`source_text`) and what shape its page takes (`LAYOUTS`). Team training is a
practice sheet (practice plan, emphasis list, play sheet, notes); a player's
training program is a checklist (focus, drills with amounts and cues, key
cues). Other report kinds can be added the same way.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading

from sqlalchemy.orm import Session

from . import models

PLAY_GROUPS = ["trans", "half_court", "sob", "bob", "zone", "free_throw", "cob"]

LAYOUTS = {
    "team_training": """Condense the TEAM TRAINING PROGRAM below into a ONE-PAGE PRACTICE SHEET a staff prints and
hands to coaches and players. Return JSON only:
{"title": "<short title, e.g. PRACTICE PLAN — TRANSITION DEFENSE>",
 "sessions": [{"label": "<e.g. PRACTICE 1, or DAY 1>",
               "drills": [{"drill": "<SHORT DRILL NAME IN CAPS>", "minutes": <int or null>, "coach": null}]}],
 "emphasis": ["<one short coaching point, coach's shorthand, e.g. P/R: 4 & 5 coverage — center or ice>"],
 "plays": {"trans": [], "half_court": [], "sob": [], "bob": [], "zone": [], "free_throw": [], "cob": []},
 "notes": ["<at most 4 short notes>"]}
Rules:
- Only what the program says. Never add a drill, time, play or point it does not contain.
- minutes: only where the program gives a time; otherwise null. Never estimate.
- sessions: the program's practices in order (at most 5); one session if it describes a single practice.
- emphasis: at most 14 lines, each under 70 characters, the way a coach writes them on a sheet.
- plays: play/set names the program names, under the group it puts them in (trans = transition/early
  offense, half_court = half-court sets, sob/bob = side/baseline out of bounds, zone = zone offense,
  free_throw, cob = special situations). Empty lists where it names none.""",
    "training": """Condense the PLAYER TRAINING PROGRAM below into a ONE-PAGE version the player and staff can scan
in seconds. Return JSON only:
{"title": "<short title>",
 "focus": ["<at most 4 focus areas, a few words each>"],
 "checklist": [{"drill": "<drill, short>", "amount": "<reps / sets / time as the program gives it, or null>",
                "cue": "<the one thing to think about, under 60 characters, or null>"}],
 "cues": ["<at most 4 key coaching cues>"]}
Rules:
- Only what the program says. Never add a drill, amount or cue it does not contain.
- checklist: the program's drills in its order, at most 16; one line each.
- amount: only as the program states it; otherwise null.""",
}

KIND_LAYOUT = {"training": "training", "team_report": "team_training", "packet_training": "team_training"}


def _hash(text: str) -> str:
    return hashlib.sha1((text or "").encode("utf-8")).hexdigest()


def source_text(db: Session, kind: str, ref_id: int) -> tuple[str | None, int | None]:
    """(standard text, owning coach id) for a report, or (None, None)."""
    if kind == "training":
        s = db.get(models.TrainingSession, ref_id)
        return (s.program_text if s else None), (s.coach_id if s else None)
    if kind == "team_report":
        r = db.get(models.TeamReport, ref_id)
        return (r.report_text if r else None), (r.coach_id if r else None)
    if kind == "packet_training":
        v = (db.query(models.GameReportVersion)
             .filter_by(game_report_id=ref_id, output_type="team_training").first())
        gr = db.get(models.GameReport, ref_id)
        return (v.report_text if v else None), (gr.coach_id if gr else None)
    return None, None


def _parse(raw: str) -> dict | None:
    raw = (raw or "").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
    try:
        v = json.loads(raw)
    except ValueError:
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            return None
        try:
            v = json.loads(m.group(0))
        except ValueError:
            return None
    return v if isinstance(v, dict) else None


def _clean(layout: str, d: dict) -> dict:
    """Keep the page to its shape: no stray keys, lists capped, types right."""
    def strs(xs, n, width=120):
        return [str(x).strip()[:width] for x in (xs or []) if str(x or "").strip()][:n]
    if layout == "team_training":
        sessions = []
        for sess in (d.get("sessions") or [])[:5]:
            if not isinstance(sess, dict):
                continue
            drills = []
            for dr in (sess.get("drills") or [])[:20]:
                if not isinstance(dr, dict) or not str(dr.get("drill") or "").strip():
                    continue
                m = dr.get("minutes")
                drills.append({"drill": str(dr["drill"]).strip()[:80],
                               "minutes": int(m) if isinstance(m, (int, float)) and 0 < m < 600 else None,
                               "coach": (str(dr.get("coach")).strip()[:20] if dr.get("coach") else None)})
            if drills:
                sessions.append({"label": str(sess.get("label") or "").strip()[:40], "drills": drills})
        plays = d.get("plays") if isinstance(d.get("plays"), dict) else {}
        return {"title": str(d.get("title") or "").strip()[:80], "sessions": sessions,
                "emphasis": strs(d.get("emphasis"), 14, 90),
                "plays": {g: strs(plays.get(g), 12, 40) for g in PLAY_GROUPS},
                "notes": strs(d.get("notes"), 4, 200)}
    checklist = []
    for c in (d.get("checklist") or [])[:16]:
        if isinstance(c, dict) and str(c.get("drill") or "").strip():
            checklist.append({"drill": str(c["drill"]).strip()[:100],
                              "amount": (str(c.get("amount")).strip()[:40] if c.get("amount") else None),
                              "cue": (str(c.get("cue")).strip()[:90] if c.get("cue") else None)})
    return {"title": str(d.get("title") or "").strip()[:80], "focus": strs(d.get("focus"), 4, 60),
            "checklist": checklist, "cues": strs(d.get("cues"), 4, 120)}


def _make(kind: str, ref_id: int, text: str, text_hash: str) -> None:
    """Write the short version (its own session; runs in a thread)."""
    import asyncio
    from .ai_models import long_text
    from .database import SessionLocal
    layout = KIND_LAYOUT[kind]
    prompt = (f"{LAYOUTS[layout]}\n\nWrite every text value in the same language as the program.\n\n"
              f"THE PROGRAM:\n{text[:24000]}")
    data, err = None, None
    try:
        raw = asyncio.run(long_text(prompt, max_tokens=4000))
        got = _parse(raw)
        data = _clean(layout, got) if got else None
        if data is None:
            err = "The short version came back unreadable."
    except Exception as e:  # noqa: BLE001 — recorded on the row, shown as failed
        err = str(e)[:500]
    db = SessionLocal()
    try:
        row = db.query(models.ShortVersion).filter_by(kind=kind, ref_id=ref_id).first()
        if row is None:
            return
        # A newer text arrived while this one was being written: leave the row
        # for that run.
        if row.source_hash != text_hash:
            return
        row.data, row.status, row.error = (data, "ready", None) if data else (row.data, "failed", err)
        db.commit()
    finally:
        db.close()


def ensure(db: Session, kind: str, ref_id: int, *, force: bool = False) -> models.ShortVersion | None:
    """The short version as it stands; starts making it when it is missing,
    failed or made from older text. Returns None when the report has no text."""
    text, coach_id = source_text(db, kind, ref_id)
    if not (text or "").strip():
        return None
    h = _hash(text)
    row = db.query(models.ShortVersion).filter_by(kind=kind, ref_id=ref_id).first()
    if row is not None and not force:
        if row.source_hash == h and row.status in ("ready", "making"):
            return row
        # The coach's own version outlives a change to the standard; the page
        # says it is out of date and offers the remake.
        if row.edited and row.data and row.status != "making":
            return row
    if row is None:
        row = models.ShortVersion(kind=kind, ref_id=ref_id, coach_id=coach_id)
        db.add(row)
    row.source_hash, row.status, row.error, row.edited = h, "making", None, False
    db.commit()
    db.refresh(row)
    threading.Thread(target=_make, args=(kind, ref_id, text, h), daemon=True).start()
    return row


def out(row: models.ShortVersion | None, db: Session | None = None) -> dict:
    if row is None:
        return {"status": "none", "data": None}
    stale = False
    if db is not None:
        text, _ = source_text(db, row.kind, row.ref_id)
        stale = bool(text) and _hash(text) != row.source_hash
    return {"status": row.status, "data": row.data, "error": row.error, "edited": bool(row.edited),
            "stale": stale, "updated_at": row.updated_at.isoformat() + "Z" if row.updated_at else None}


def save_edit(db: Session, kind: str, ref_id: int, data: dict) -> models.ShortVersion:
    """The coach's own version of the page: kept to the page's shape."""
    row = db.query(models.ShortVersion).filter_by(kind=kind, ref_id=ref_id).first()
    if row is None:
        text, coach_id = source_text(db, kind, ref_id)
        row = models.ShortVersion(kind=kind, ref_id=ref_id, coach_id=coach_id, source_hash=_hash(text or ""))
        db.add(row)
    row.data, row.status, row.error, row.edited = _clean(KIND_LAYOUT[kind], data or {}), "ready", None, True
    db.commit()
    db.refresh(row)
    return row


def _correct(kind: str, ref_id: int, current: dict, text: str, correction: str) -> None:
    """Apply a coach's correction to the page, in the same shape (a thread)."""
    import asyncio
    from .ai_models import long_text
    from .database import SessionLocal
    layout = KIND_LAYOUT[kind]
    prompt = (f"{LAYOUTS[layout]}\n\nThis is the CURRENT PAGE (JSON). Apply the coach's correction to it and return "
              "the whole page as JSON in the same shape. Change only what the correction asks; keep everything "
              "else exactly as it is. The coach's correction is the authority, even where it differs from the "
              "program. Write in the same language as the page.\n\n"
              f"CURRENT PAGE:\n{json.dumps(current, ensure_ascii=False)}\n\n"
              f"COACH'S CORRECTION:\n{correction[:2000]}\n\n"
              f"THE PROGRAM (for reference):\n{text[:16000]}")
    data, err = None, None
    try:
        got = _parse(asyncio.run(long_text(prompt, max_tokens=4000)))
        data = _clean(layout, got) if got else None
        if data is None:
            err = "The correction came back unreadable."
    except Exception as e:  # noqa: BLE001
        err = str(e)[:500]
    db = SessionLocal()
    try:
        row = db.query(models.ShortVersion).filter_by(kind=kind, ref_id=ref_id).first()
        if row is None:
            return
        if data:
            row.data, row.status, row.error, row.edited = data, "ready", None, True
        else:
            row.status, row.error = "ready", err     # the page as it was, with why
        db.commit()
    finally:
        db.close()


def correct(db: Session, kind: str, ref_id: int, correction: str) -> models.ShortVersion | None:
    row = db.query(models.ShortVersion).filter_by(kind=kind, ref_id=ref_id).first()
    if row is None or not row.data:
        return None
    text, _ = source_text(db, kind, ref_id)
    current = row.data
    row.status, row.error = "making", None
    db.commit()
    db.refresh(row)
    threading.Thread(target=_correct, args=(kind, ref_id, current, text or "", correction), daemon=True).start()
    return row
