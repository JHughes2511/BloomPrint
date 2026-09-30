"""Short versions of reports: the one page a staff prints and hands out.

A short version is made FROM the standard report — the same facts, cut down
to what can be read at a glance. It is made on demand: the first time someone
opens Short, then kept. When the standard text changes it is made again the
next time it is opened — unless the coach has edited or corrected it, in which
case their version stays and the page offers to remake it from the standard
(ShortVersion.source_hash, .edited).

Every report kind plugs in with two things: where its text lives
(`source_text`) and what page it gets (`layout_for`). Team training is a
practice sheet and a player's training program a checklist (their own
layouts, `LAYOUTS`); every other report — scouting, game report, player
eval, match-up, play calling, team, film — has its page described once in
`SCHEMAS`, which the prompt, the cleaning and the app all read.
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

# Every other report's page, described once: the prompt, the cleaning, and the
# app's page, edit form and print all read this, so a report type is added
# here and nowhere else. Field types: text (one value), lines (a short list),
# rows (a small table; `cols` are its columns).
SCHEMAS: dict[str, dict] = {
    "scouting": {"guide": "a ONE-PAGE SCOUTING SHEET a staff hands out before playing this team",
                 "fields": [
                     {"key": "title", "type": "text", "max": 80},
                     {"key": "overview", "type": "text", "max": 260, "hint": "who they are in two sentences"},
                     {"key": "players", "type": "rows", "max": 6, "cols": ["player", "role", "threat", "guard"],
                      "hint": "their key players: '#23 Name', role, what they hurt you with, how to guard them"},
                     {"key": "offense", "type": "lines", "max": 5, "hint": "what they run on offense"},
                     {"key": "defense", "type": "lines", "max": 5, "hint": "how they defend"},
                     {"key": "keys", "type": "lines", "max": 5, "hint": "our keys to win"}]},
    "game_report": {"guide": "a ONE-PAGE GAME SUMMARY for staff and players",
                    "fields": [
                        {"key": "title", "type": "text", "max": 80},
                        {"key": "result", "type": "text", "max": 140, "hint": "the result and the one thing that decided it"},
                        {"key": "worked", "type": "lines", "max": 3},
                        {"key": "didnt", "type": "lines", "max": 3},
                        {"key": "standouts", "type": "rows", "max": 5, "cols": ["player", "note"]},
                        {"key": "next", "type": "lines", "max": 4, "hint": "adjustments for next time"}]},
    "player_eval": {"guide": "a ONE-PAGE PLAYER CARD a player and staff read at a glance",
                    "fields": [
                        {"key": "title", "type": "text", "max": 80},
                        {"key": "grade", "type": "text", "max": 24, "hint": "the overall grade as the report gives it"},
                        {"key": "separation", "type": "text", "max": 160,
                         "hint": "the IDENTIFY verdict word for word (DOMINANT, SEPARATES, ONE-TOOL SEPARATOR, AT LEVEL "
                                 "or BEHIND THE LEVEL) and its reason; empty if the report has no IDENTIFY"},
                        {"key": "pillars", "type": "rows", "max": 6, "cols": ["pillar", "grade"]},
                        {"key": "strengths", "type": "lines", "max": 3},
                        {"key": "watch", "type": "lines", "max": 3, "hint": "watch flags / what to fix"},
                        {"key": "focus", "type": "text", "max": 220, "hint": "the one focus from here"},
                        {"key": "cues", "type": "lines", "max": 3, "hint": "short coaching cues"},
                        {"key": "projection", "type": "rows", "max": 3, "cols": ["outcome", "level_role"],
                         "hint": "from PROJECTION: Best case, Likely, Floor, each with its level and role; empty if none"},
                        {"key": "comps", "type": "lines", "max": 2, "hint": "the style comp and the level comp from PROJECTION"},
                        {"key": "confidence", "type": "text", "max": 120, "hint": "the projection's confidence and what it rests on"}]},
    "matchup": {"guide": "a ONE-PAGE MATCH-UP comparison",
                "fields": [
                    {"key": "title", "type": "text", "max": 80},
                    {"key": "sides", "type": "lines", "max": 2, "hint": "the two sides compared, in order"},
                    {"key": "compare", "type": "rows", "max": 8, "cols": ["area", "first", "second", "edge"],
                     "hint": "area, first side, second side, who has the edge (a name or 'even')"},
                    {"key": "verdict", "type": "text", "max": 260},
                    {"key": "separation", "type": "lines", "max": 4,
                     "hint": "each subject's IDENTIFY verdict word for word, 'Name: VERDICT'; empty if none"},
                    {"key": "projection", "type": "lines", "max": 5,
                     "hint": "from PROJECTION: each subject's likely level and role in 4-5 years, then who projects higher"}]},
    "play_calling": {"guide": "a ONE-PAGE PLAY CALLING SHEET",
                     "fields": [
                         {"key": "title", "type": "text", "max": 80},
                         {"key": "summary", "type": "text", "max": 240},
                         {"key": "best", "type": "rows", "max": 5, "cols": ["play", "defense", "result"],
                          "hint": "the calls that worked, with the counts the report gives"},
                         {"key": "worst", "type": "rows", "max": 4, "cols": ["play", "defense", "result"]},
                         {"key": "keep", "type": "lines", "max": 4, "hint": "keep calling"},
                         {"key": "change", "type": "lines", "max": 4, "hint": "change or drop"}]},
    "team": {"guide": "a ONE-PAGE TEAM SUMMARY",
             "fields": [
                 {"key": "title", "type": "text", "max": 80},
                 {"key": "grade", "type": "text", "max": 24},
                 {"key": "summary", "type": "text", "max": 240},
                 {"key": "strengths", "type": "lines", "max": 4},
                 {"key": "needs", "type": "lines", "max": 4},
                 {"key": "priorities", "type": "lines", "max": 4}]},
    "film": {"guide": "a ONE-PAGE FILM SUMMARY",
             "fields": [
                 {"key": "title", "type": "text", "max": 80},
                 {"key": "summary", "type": "text", "max": 240},
                 {"key": "moments", "type": "lines", "max": 6, "hint": "what the film showed, with timestamps where the report gives them"},
                 {"key": "takeaways", "type": "lines", "max": 4}]},
}

# The kinds a short version can be asked for, by where the report lives.
KINDS = {"training", "team_report", "packet_training", "eval", "scouting", "game_full", "play_calling",
         "film", "packet_version", "shared", "player_share", "player_team_share"}


def _layout_for_types(types: set[str]) -> str:
    if "matchup" in types:
        return "matchup"
    if "team_training" in types:
        return "team_training"
    if types & {"training_program", "training"}:
        return "training"
    if types & {"player_eval", "recruitment_profile", "position_analysis", "coaching_report", "film_breakdown"} \
            and not types & {"game_report", "game_analysis", "game_situational"}:
        return "player_eval"
    if "scouting_report" in types:
        return "scouting"
    if types & {"game_report", "game_analysis"}:
        return "game_report"
    return "team"


def _types(output_type: str | None) -> set[str]:
    return {t.strip() for t in (output_type or "").split(",") if t.strip()}


def layout_for(db: Session, kind: str, ref_id: int) -> str:
    """What page a report gets: fixed for some kinds, by report type for others."""
    if kind in ("training", "packet_training"):
        return KIND_LAYOUT[kind]
    if kind == "scouting":
        return "scouting"
    if kind == "game_full":
        return "game_report"
    if kind == "play_calling":
        return "play_calling"
    if kind == "film":
        return "film"
    if kind == "eval":
        e = db.get(models.Evaluation, ref_id)
        return "matchup" if e and "matchup" in _types(e.output_type) else "player_eval"
    if kind == "team_report":
        r = db.get(models.TeamReport, ref_id)
        types = _types(r.output_type if r else "")
        return "matchup" if "matchup" in types else "team_training" if "team_training" in types else "team"
    if kind == "shared":
        sh = db.get(models.StaffSharedReport, ref_id)
        if sh is None:
            return "team"
        rt = sh.report_type
        if rt == "eval":
            e = db.get(models.Evaluation, sh.report_id)
            return "matchup" if e and "matchup" in _types(e.output_type) else "player_eval"
        if rt == "team_report":
            r = db.get(models.TeamReport, sh.report_id)
            return _layout_for_types(_types(r.output_type if r else "")) if r else "team"
        if rt in ("training", "team_training"):
            return rt
        if rt in ("game_session", "scouting"):
            return "scouting"
        if rt == "game_report":
            return "game_report"
        if rt == "film":
            return "film"
        if rt == "game":
            gr = db.get(models.GameReport, sh.report_id)
            return _layout_for_types(_types(gr.output_type if gr else "")) if gr else "team"
        return "team"
    if kind == "player_share":
        sh = db.get(models.SharedReport, ref_id)
        e = sh.evaluation if sh else None
        return "matchup" if e and "matchup" in _types(e.output_type) else "player_eval"
    if kind == "player_team_share":
        r = db.get(models.TeamSharedReport, ref_id)
        return _layout_for_types(_types(r.output_type if r else ""))
    if kind == "packet_version":
        v = db.get(models.GameReportVersion, ref_id)
        types = _types(v.output_type if v else "")
        if "matchup" in types:
            return "matchup"
        if "team_training" in types:
            return "team_training"
        if "scouting_report" in types:
            return "scouting"
        if types & {"game_report", "game_analysis"}:
            return "game_report"
        return "team"
    return "team"


def schema_prompt(layout: str) -> str:
    sch = SCHEMAS[layout]
    shape = []
    for f in sch["fields"]:
        hint = f" — {f['hint']}" if f.get("hint") else ""
        if f["type"] == "text":
            shape.append(f'"{f["key"]}": "<text, at most {f["max"]} characters{hint}>"')
        elif f["type"] == "lines":
            shape.append(f'"{f["key"]}": ["<at most {f["max"]} short lines{hint}>"]')
        else:
            cols = ", ".join(f'"{c}": "<short>"' for c in f["cols"])
            shape.append(f'"{f["key"]}": [{{{cols}}}]  (at most {f["max"]} rows{hint})')
    return (f"Condense the REPORT below into {sch['guide']}. Return JSON only:\n{{" + ",\n ".join(shape) + "}\n"
            "Rules:\n- Only what the report says. Never add a player, number, grade, count or claim it does not "
            "contain; leave a field empty rather than guess.\n- Short, scannable lines: the way a coach writes "
            "on a sheet, not sentences copied from the report.")


def _clean_schema(layout: str, d: dict) -> dict:
    out: dict = {}
    for f in SCHEMAS[layout]["fields"]:
        v = d.get(f["key"])
        if f["type"] == "text":
            out[f["key"]] = str(v or "").strip()[:f["max"]]
        elif f["type"] == "lines":
            out[f["key"]] = [str(x).strip()[:160] for x in (v or []) if str(x or "").strip()][:f["max"]]
        else:
            rows = []
            for r in (v or []):
                if isinstance(r, dict):
                    row = {c: str(r.get(c) or "").strip()[:120] for c in f["cols"]}
                    if any(row.values()):
                        rows.append(row)
            out[f["key"]] = rows[:f["max"]]
    return out


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
    if kind == "eval":
        e = db.get(models.Evaluation, ref_id)
        return (e.report_text if e else None), (e.coach_id if e else None)
    if kind == "scouting":
        r = db.get(models.GameScoutingReport, ref_id)
        return (r.report_text if r else None), (r.coach_id if r else None)
    if kind == "game_full":
        r = db.get(models.GameFullReport, ref_id)
        return (r.report_text if r else None), (r.coach_id if r else None)
    if kind == "play_calling":
        r = db.get(models.PlayCallingReport, ref_id)
        return (r.report_text if r else None), (r.coach_id if r else None)
    if kind == "film":
        c = db.get(models.GameReportClip, ref_id)
        gr = c.game_report if c else None
        return (c.analysis_text if c else None), (gr.coach_id if gr else None)
    if kind == "packet_version":
        v = db.get(models.GameReportVersion, ref_id)
        gr = db.get(models.GameReport, v.game_report_id) if v else None
        return (v.report_text if v else None), (gr.coach_id if gr else None)
    if kind == "shared":
        # What the recipient reads: their own updated copy if they made one.
        sh = db.get(models.StaffSharedReport, ref_id)
        return ((sh.regenerated_text or sh.frozen_text) if sh else None), (sh.recipient_id if sh else None)
    if kind == "player_share":
        # Only what the player is allowed to see: the share's own filtered text
        # (grades, flags and hidden sections already taken out), never the
        # coach's full report.
        sh = db.get(models.SharedReport, ref_id)
        if sh is None:
            return None, None
        from .routes.player_routes import _build_shared_report_out
        return (_build_shared_report_out(sh).report_text or None), None
    if kind == "player_team_share":
        r = db.get(models.TeamSharedReport, ref_id)
        from .routes.player_routes import team_share_text
        return (team_share_text(r) or None) if r else None, None
    return None, None


# Play sheet groups, from Play Calling's play types.
TYPE_GROUP = {"transition": "trans", "semi_transition": "trans", "transition_drag": "trans",
              "half_court": "half_court", "ato": "half_court", "sob": "sob", "bob": "bob", "zone": "zone",
              "free_throw": "free_throw", "cob": "cob"}
GROUP_TYPE = {"trans": "transition", "half_court": "half_court", "sob": "sob", "bob": "bob", "zone": "zone",
              "free_throw": "free_throw", "cob": "cob"}


def team_for(db: Session, kind: str, ref_id: int) -> models.Team | None:
    """The team a team-training report is about: the one it was made for; for
    an older report without one, the coach's team when they have just one."""
    tid = None
    if kind == "team_report":
        r = db.get(models.TeamReport, ref_id)
        tid = getattr(r, "team_id", None) if r else None
        if tid is None and r is not None:
            own = db.query(models.Team).filter_by(coach_id=r.coach_id, parent_team_id=None).all() \
                if hasattr(models.Team, "parent_team_id") else db.query(models.Team).filter_by(coach_id=r.coach_id).all()
            tid = own[0].id if len(own) == 1 else None
    elif kind == "packet_training":
        gr = db.get(models.GameReport, ref_id)
        tid = gr.my_team_id if gr else None
    return db.get(models.Team, tid) if tid else None


def _initials(name: str) -> str:
    parts = [p for p in re.split(r"\s+", (name or "").strip()) if p]
    if not parts:
        return ""
    return (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()


def staff_for(db: Session, team: models.Team | None) -> list[dict]:
    """The team's staff with initials, head coach (owner) first. Two with the
    same initials get more of the surname so each cell names one person."""
    if team is None:
        return []
    people = [db.get(models.Coach, team.coach_id)] + [ts.coach for ts in db.query(models.TeamStaff).filter_by(team_id=team.id).all()]
    seen, out = set(), []
    for c in people:
        if c is None or c.id in seen:
            continue
        seen.add(c.id)
        out.append({"id": c.id, "name": c.name, "title": c.job_title or "", "initials": _initials(c.name)})
    counts: dict[str, int] = {}
    for p in out:
        counts[p["initials"]] = counts.get(p["initials"], 0) + 1
    for p in out:
        if counts[p["initials"]] > 1:
            last = p["name"].split()[-1] if p["name"].split() else ""
            p["initials"] = (p["name"][:1] + last[:2]).upper()
    out[0]["head"] = True
    return out


def catalog_groups(db: Session, team: models.Team | None) -> dict[str, list[str]]:
    """The team's own plays from Play Calling, most used first, by sheet group."""
    groups: dict[str, list[str]] = {g: [] for g in PLAY_GROUPS}
    if team is None:
        return groups
    for e in (db.query(models.PlayCatalogEntry).filter_by(team_id=team.id)
              .order_by(models.PlayCatalogEntry.uses.desc()).all()):
        g = TYPE_GROUP.get(e.play_type or "")
        if g and e.name not in groups[g]:
            groups[g].append(e.name)
    return groups


def _merge_catalog(data: dict, groups: dict[str, list[str]]) -> dict:
    plays = data.setdefault("plays", {g: [] for g in PLAY_GROUPS})
    for g in PLAY_GROUPS:
        have = {x.lower() for x in plays.get(g, [])}
        for name in groups.get(g, []):
            if name.lower() not in have and len(plays.setdefault(g, [])) < 12:
                plays[g].append(name)
                have.add(name.lower())
    return data


def learn_play_types(db: Session, team: models.Team | None, data: dict) -> None:
    """A play the coach moved to another group on the sheet takes that type in
    the team's catalog, so the next sheet puts it there without being told."""
    if team is None:
        return
    by_name = {e.name.lower(): e for e in db.query(models.PlayCatalogEntry).filter_by(team_id=team.id).all()}
    for g, names in (data.get("plays") or {}).items():
        typ = GROUP_TYPE.get(g)
        for n in names or []:
            e = by_name.get(str(n).lower())
            if e is not None and typ and TYPE_GROUP.get(e.play_type or "") != g:
                e.play_type = typ


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
    if layout in SCHEMAS:
        return _clean_schema(layout, d)
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


def _make(kind: str, ref_id: int, text: str, text_hash: str, staff: list | None = None,
          groups: dict | None = None, layout: str = "") -> None:
    """Write the short version (its own session; runs in a thread)."""
    import asyncio
    from .ai_models import long_text
    from .database import SessionLocal
    layout = layout or KIND_LAYOUT[kind]
    staff_block = ""
    if staff:
        def who(p):
            bits = [p["name"]] + (["head coach"] if p.get("head") else []) + ([p["title"]] if p.get("title") else [])
            return f"{p['initials']} = " + ", ".join(bits)
        staff_block = ("\n\nSTAFF (fill each drill's \"coach\" with ONE of these initials): "
                       + "; ".join(who(p) for p in staff)
                       + ". Use the coach the program names for a drill if it names one. Otherwise: the head coach "
                         "runs team segments (walk-throughs, script, scrimmage, situations); spread skill and "
                         "position work across the others by their titles.")
    guide = LAYOUTS[layout] if layout in LAYOUTS else schema_prompt(layout)
    prompt = (f"{guide}{staff_block}\n\nWrite every text value in the same language as the report.\n\n"
              f"THE REPORT:\n{text[:24000]}")
    data, err = None, None
    try:
        raw = asyncio.run(long_text(prompt, max_tokens=4000))
        got = _parse(raw)
        data = _clean(layout, got) if got else None
        if data is not None and layout == "team_training" and groups:
            data = _merge_catalog(data, groups)
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
    staff, groups = None, None
    layout = layout_for(db, kind, ref_id)
    if layout == "team_training":
        team = team_for(db, kind, ref_id)
        staff = [{k: v for k, v in p.items() if k != "id"} for p in staff_for(db, team)]
        groups = catalog_groups(db, team)
    threading.Thread(target=_make, args=(kind, ref_id, text, h, staff, groups, layout), daemon=True).start()
    return row


def out(row: models.ShortVersion | None, db: Session | None = None) -> dict:
    if row is None:
        return {"status": "none", "data": None}
    stale = False
    if db is not None:
        text, _ = source_text(db, row.kind, row.ref_id)
        stale = bool(text) and _hash(text) != row.source_hash
    layout = layout_for(db, row.kind, row.ref_id) if db is not None else KIND_LAYOUT.get(row.kind, "team")
    return {"status": row.status, "data": row.data, "error": row.error, "edited": bool(row.edited),
            "stale": stale, "layout": layout, "schema": SCHEMAS.get(layout, {}).get("fields"),
            "updated_at": row.updated_at.isoformat() + "Z" if row.updated_at else None}


def save_edit(db: Session, kind: str, ref_id: int, data: dict) -> models.ShortVersion:
    """The coach's own version of the page: kept to the page's shape."""
    row = db.query(models.ShortVersion).filter_by(kind=kind, ref_id=ref_id).first()
    if row is None:
        text, coach_id = source_text(db, kind, ref_id)
        row = models.ShortVersion(kind=kind, ref_id=ref_id, coach_id=coach_id, source_hash=_hash(text or ""))
        db.add(row)
    layout = layout_for(db, kind, ref_id)
    row.data, row.status, row.error, row.edited = _clean(layout, data or {}), "ready", None, True
    if layout == "team_training":
        learn_play_types(db, team_for(db, kind, ref_id), row.data)
    db.commit()
    db.refresh(row)
    return row


def _correct(kind: str, ref_id: int, current: dict, text: str, correction: str, layout: str = "") -> None:
    """Apply a coach's correction to the page, in the same shape (a thread)."""
    import asyncio
    from .ai_models import long_text
    from .database import SessionLocal
    layout = layout or KIND_LAYOUT[kind]
    guide = LAYOUTS[layout] if layout in LAYOUTS else schema_prompt(layout)
    prompt = (f"{guide}\n\nThis is the CURRENT PAGE (JSON). Apply the coach's correction to it and return "
              "the whole page as JSON in the same shape. Change only what the correction asks; keep everything "
              "else exactly as it is. The coach's correction is the authority, even where it differs from the "
              "program. Write in the same language as the page.\n\n"
              f"CURRENT PAGE:\n{json.dumps(current, ensure_ascii=False)}\n\n"
              f"COACH'S CORRECTION:\n{correction[:2000]}\n\n"
              f"THE REPORT (for reference):\n{text[:16000]}")
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
    threading.Thread(target=_correct, args=(kind, ref_id, current, text or "", correction,
                                            layout_for(db, kind, ref_id)), daemon=True).start()
    return row
