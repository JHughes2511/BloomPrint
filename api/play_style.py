"""Coaching-style profile — a per-coach text profile the AI accumulates over
time from the coach's drawn plays (hand-drawn boards + AI-generated boards) and
reads on every play draw-up, so a short brief is positioned the way this coach
draws. It learns incrementally: each draw-up folds in any boards changed since
the profile was last synced.

Kept deliberately cheap: the merge model call runs only when there are new/
changed boards, and at most a handful of boards are described per pass.
"""
import json

from . import models

# Court geometry — MUST match the client (WhiteboardModal.tsx) so hand-drawn
# pixel strokes convert back to court-feet the same way.
COURT_FT_L = 94
OOB_SIDE_FT = 3
OOB_BASE_FT = 4
PADDED_FT_W = 50 + OOB_SIDE_FT * 2  # 56
VISIBLE_FT = {"full": 94, "three_quarter": 78, "half": 47}


def _disp(pid) -> str:
    pid = str(pid or "")
    return ("D" + pid[1:]) if pid[:1] == "X" else pid


def _describe_ai(ai: dict) -> str:
    schemes = ai.get("schemes") or {}
    lines = [f'PLAY "{str(ai.get("play_name") or "play")[:40]}":']
    for scheme in ("offense", "defense", "counter"):
        sc = schemes.get(scheme)
        if not isinstance(sc, dict):
            continue
        units = list(sc.get("players") or []) + list(sc.get("defenders") or [])
        if not units:
            continue
        spots = ", ".join(
            f"{_disp(u.get('id'))}@({round(float(u.get('x', 25)))},{round(float(u.get('y', 80)))})"
            for u in units
        )
        lines.append(f"  {scheme}: {spots}")
        acts = sc.get("actions") or []
        if acts:
            lines.append("    actions: " + "; ".join(
                f"{_disp(a.get('actor'))} {a.get('kind')} "
                f"({round(float((a.get('from') or [0, 0])[0]))},{round(float((a.get('from') or [0, 0])[1]))})"
                f"->({round(float((a.get('to') or [0, 0])[0]))},{round(float((a.get('to') or [0, 0])[1]))})"
                for a in acts[:8]
            ))
    key = ai.get("key") or []
    if key:
        lines.append("  key: " + " | ".join(str(k.get("text") or "")[:80] for k in key[:4]))
    return "\n".join(lines)


def _describe_handdrawn(strokes: list, canvas, court_type: str) -> str:
    if not strokes:
        return ""
    w = None
    ctype = court_type
    if isinstance(canvas, dict):
        w = canvas.get("w")
        ctype = canvas.get("type") or court_type
    labels = [str(s.get("label")) for s in strokes if s.get("type") == "text" and s.get("label")]
    try:
        w = float(w)
    except (TypeError, ValueError):
        w = 0
    if w and w > 0:
        scale = w / PADDED_FT_W
        off = COURT_FT_L - VISIBLE_FT.get(ctype, 94)

        def feet(px, py):
            return (round(px / scale - OOB_SIDE_FT), round(py / scale + off))

        circles = [feet(s["cx"], s["cy"]) for s in strokes if s.get("type") == "circle" and s.get("cx") is not None]
        xs = [feet(s["cx"], s["cy"]) for s in strokes if s.get("type") == "xmark" and s.get("cx") is not None]
        arrows = [(feet(s["x1"], s["y1"]), feet(s["x2"], s["y2"])) for s in strokes
                  if s.get("type") == "arrow" and s.get("x1") is not None]
        parts = []
        if circles:
            parts.append("offense/ball spots (feet): " + ", ".join(f"({x},{y})" for x, y in circles[:10]))
        if xs:
            parts.append("defender spots (feet): " + ", ".join(f"({x},{y})" for x, y in xs[:10]))
        if arrows:
            parts.append("movement/passes: " + "; ".join(f"{a}->{b}" for a, b in arrows[:12]))
        if labels:
            parts.append("labels: " + ", ".join(labels[:12]))
        if not parts:
            return ""
        return "HAND-DRAWN PLAY:\n  " + "\n  ".join(parts)
    # No canvas dims (older board): coarse summary only.
    n = len(strokes)
    if not labels and n < 3:
        return ""
    out = f"HAND-DRAWN PLAY: {n} marks"
    if labels:
        out += "; labels: " + ", ".join(labels[:12])
    return out


def _describe_board(b: "models.GameWhiteboard") -> str:
    try:
        parsed = json.loads(b.data or "[]")
    except Exception:
        return ""
    if isinstance(parsed, list):
        strokes, ai, canvas = parsed, None, None
    elif isinstance(parsed, dict):
        strokes = parsed.get("strokes") or []
        ai = parsed.get("ai")
        canvas = parsed.get("canvas")
    else:
        return ""
    if isinstance(ai, dict) and ai.get("schemes"):
        return _describe_ai(ai)
    return _describe_handdrawn(strokes, canvas, b.court_type)


def _merge_profile(existing: str, descs: list) -> str:
    import anthropic
    joined = "\n\n".join(descs[:8])[:9000]
    prompt = (
        "You maintain a concise COACHING STYLE PROFILE for ONE basketball coach — how they position "
        "players and what they favor: base formations & spacing, favored offensive actions, defensive "
        "setups, inbound tendencies, and any recurring player roles. This profile is fed to an AI play "
        "generator so that a short brief gets drawn the way THIS coach draws.\n\n"
        f"EXISTING PROFILE:\n{existing or '(none yet — build it from scratch)'}\n\n"
        f"NEW PLAYS THE COACH JUST DREW (positions are half-court feet: x 0=left/50=right, "
        f"y grows toward the rim):\n{joined}\n\n"
        "Update the profile to fold in consistent patterns from these plays — reinforce repeated "
        "tendencies, add new ones, and keep anything still relevant. Keep it under 320 words as short "
        "bulleted tendencies. Output ONLY the profile text, no preamble."
    )
    resp = anthropic.Anthropic().messages.create(
        model="claude-opus-4-7", max_tokens=900,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in resp.content if hasattr(b, "text"))


def refresh_and_get_profile(db, coach) -> str:
    """Fold any boards changed since last sync into the coach's style profile,
    then return the current profile text. Best-effort and bounded."""
    import os
    profile = coach.play_style_profile or ""
    synced = coach.play_style_synced_at
    boards = (db.query(models.GameWhiteboard)
              .filter_by(coach_id=coach.id)
              .order_by(models.GameWhiteboard.updated_at.desc())
              .limit(8).all())
    new_boards = [b for b in boards if b.updated_at and (synced is None or b.updated_at > synced)]
    if not new_boards or not os.environ.get("ANTHROPIC_API_KEY"):
        return profile
    latest = max((b.updated_at for b in new_boards if b.updated_at), default=synced)
    descs = [d for d in (_describe_board(b) for b in new_boards) if d and d.strip()]
    if not descs:
        coach.play_style_synced_at = latest
        db.commit()
        return profile
    try:
        merged = _merge_profile(profile, descs)
    except Exception:
        return profile
    if merged and merged.strip():
        coach.play_style_profile = merged.strip()[:4000]
    coach.play_style_synced_at = latest
    db.commit()
    return coach.play_style_profile or ""
