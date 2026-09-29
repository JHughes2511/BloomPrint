"""Who is the player in each clip of a highlight tape.

A game film follows a player by one uniform colour and one jersey number for
the whole film (player_events.directive's `focus`). A highlight tape breaks
that: it is cut together from many games, so the colour changes clip to clip
and so, sometimes, does the number (club, national team, AAU).

So a tape is read clip by clip. The clips are found from the motion pre-scan
the sampler already does — a cut is a spike in frame-to-frame difference — and
each clip is shown to the model with what is known about the player: every
number they have worn, how they look (build, hair, gear, shoes — never skin
colour or faces), and a few reference frames of them from earlier films. Each
clip comes back yes / no / unsure, with the colour and number worn in it.

Only "yes" clips count. The unsure ones are shown to the coach to confirm;
what is never confirmed is left out, and the report says how many. What is
confirmed is how the app learns the player (api/player_look.py), so the next
tape asks less.
"""
from __future__ import annotations

import base64
import json
import re

import cv2
import numpy as np

# A cut is a frame-to-frame difference this many times the film's typical one
# (and never below the floor, so a static broadcast is not chopped up).
CUT_FACTOR = 5.0
CUT_FLOOR = 18.0
MIN_CLIP = 1.5            # seconds; shorter pieces are merged into the one before
BATCH = 6                 # clips per identification call


def clip_bounds(duration: float, scores: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """The clips of a film as (start, end) seconds, from the motion pre-scan."""
    if duration <= 0:
        return []
    diffs = [s for _, s in scores[1:]] if scores else []
    if not diffs:
        return [(0.0, duration)]
    thr = max(CUT_FLOOR, float(np.median(diffs)) * CUT_FACTOR)
    bounds = [0.0]
    for t, s in scores[1:]:
        if s >= thr and t - bounds[-1] >= MIN_CLIP:
            bounds.append(float(t))
    if duration - bounds[-1] < MIN_CLIP and len(bounds) > 1:
        bounds.pop()
    bounds.append(duration)
    return [(round(bounds[i], 2), round(bounds[i + 1], 2)) for i in range(len(bounds) - 1)]


def is_highlight_tape(duration: float, clips: list[tuple[float, float]]) -> bool:
    """Many short clips, not one continuous game: at least four cuts and clips
    that average half a minute or less."""
    return len(clips) >= 5 and duration / max(len(clips), 1) <= 30.0


def _grab(cap, t: float):
    cap.set(cv2.CAP_PROP_POS_MSEC, max(t, 0.0) * 1000)
    ok, frame = cap.read()
    return frame if ok else None


def _jpeg(frame, max_edge: int = 768, quality: int = 80) -> bytes:
    h, w = frame.shape[:2]
    if max(h, w) > max_edge:
        s = max_edge / max(h, w)
        frame = cv2.resize(frame, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return buf.tobytes() if ok else b""


def _b64(data: bytes) -> str:
    return base64.standard_b64encode(data).decode("utf-8")


def _who_text(who: dict) -> str:
    bits = [f"THE PLAYER: {who.get('name') or 'the player'}"]
    nums = [str(n) for n in (who.get("numbers") or []) if str(n).strip()]
    if nums:
        bits.append("Jersey numbers they have worn: " + ", ".join(f"#{n}" for n in nums)
                    + " (a new number is possible on another team).")
    if who.get("position"):
        bits.append(f"Position: {who['position']}.")
    if who.get("height"):
        bits.append(f"Height: {who['height']}.")
    if who.get("traits"):
        bits.append("How they look (learned from earlier film): " + "; ".join(who["traits"]) + ".")
    return "\n".join(bits)


PROMPT = """You are finding one basketball player in the clips of a highlight tape. A tape is cut
together from several games, so the player's uniform colour — and sometimes their number — can
change from clip to clip. A highlight tape is usually ABOUT this player, but do not assume it.

{who}

{refs}For each clip below you get two frames. Decide whether THE PLAYER is in the clip and doing
the play, and if so what they wear in it. Use jersey number first (if it is readable), then build,
height against the others, hair, headband / sleeves / shoes, handedness. Do NOT use skin colour or
facial features.

Reply with JSON only:
{{"clips": [{{"clip": <number>, "present": "yes" | "no" | "unsure",
             "uni": "<their uniform colour in this clip, one or two plain words, or null>",
             "no": "<their jersey number as printed in this clip, or null if unreadable>",
             "box": [x0, y0, x1, y1] or null,
             "traits": ["<up to 6 short visible traits of THE PLAYER in this clip, e.g. tall, slim build, white headband, left arm sleeve, red shoes, left-handed>"]}}]}}
Rules:
- "yes" only when you are sure it is them: a known number clearly readable, or a number you cannot read
  but everything else matches unmistakably. A new number with a matching look is "unsure".
- "box" is where THE PLAYER is in the SECOND frame of that clip, as fractions of width and height (0-1).
- "no" when they are clearly not in it; "unsure" whenever you are not sure. Never guess."""


def identify(video_path: str, clips: list[tuple[float, float]], who: dict, client, model: str,
             on_progress=None) -> list[dict]:
    """One verdict per clip: {start, end, present, uni, no, box, traits, frame (jpeg bytes)}."""
    from api.ai_models import text_of
    refs = [r for r in (who.get("refs") or []) if r][:3]
    ref_text = ("REFERENCE FRAMES of THE PLAYER from earlier film follow first (the player is in the "
                "middle of each).\n\n" if refs else "")
    cap = cv2.VideoCapture(video_path)
    out: list[dict] = []
    try:
        for b in range(0, len(clips), BATCH):
            batch = clips[b:b + BATCH]
            content: list[dict] = [{"type": "text", "text": PROMPT.format(who=_who_text(who), refs=ref_text)}]
            for r in refs:
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": _b64(r)}})
            mids: dict[int, bytes] = {}
            for k, (s, e) in enumerate(batch, start=b + 1):
                span = e - s
                f1, f2 = _grab(cap, s + span * 0.3), _grab(cap, s + span * 0.6)
                content.append({"type": "text", "text": f"CLIP {k} ({int(s)//60:02d}:{int(s)%60:02d}–{int(e)//60:02d}:{int(e)%60:02d})"})
                for f in (f1, f2):
                    if f is not None:
                        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": _b64(_jpeg(f))}})
                if f2 is not None:
                    mids[k] = _jpeg(f2, max_edge=960, quality=85)
            got: dict = {}
            try:
                r = client.messages.create(model=model, max_tokens=3000, messages=[{"role": "user", "content": content}])
                got = _parse(text_of(r)) or {}
            except Exception:
                got = {}
            by_clip = {int(c.get("clip")): c for c in (got.get("clips") or []) if isinstance(c, dict) and str(c.get("clip", "")).isdigit()}
            for k, (s, e) in enumerate(batch, start=b + 1):
                c = by_clip.get(k) or {}
                present = c.get("present") if c.get("present") in ("yes", "no", "unsure") else "unsure"
                no = re.sub(r"[^0-9]", "", str(c.get("no") or "")) or None
                box = c.get("box") if isinstance(c.get("box"), list) and len(c.get("box")) == 4 else None
                out.append({"clip": k, "start": s, "end": e, "present": present,
                            "uni": (str(c.get("uni")).strip().lower()[:30] if c.get("uni") else None),
                            "no": (str(int(no)) if no and no != "00" else no),
                            "box": box, "traits": [str(x).strip()[:40] for x in (c.get("traits") or []) if str(x).strip()][:6],
                            "frame": mids.get(k)})
            if on_progress:
                try:
                    on_progress(min(b + BATCH, len(clips)), len(clips))
                except Exception:
                    pass
    finally:
        cap.release()
    return out


def _parse(raw: str) -> dict | None:
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip())
    m = re.search(r"\{.*\}", raw, re.S)
    for cand in (raw, m.group(0) if m else None):
        if not cand:
            continue
        try:
            v = json.loads(cand)
            return v if isinstance(v, dict) else None
        except ValueError:
            continue
    return None


def thumbnail(frame_jpeg: bytes | None, box) -> bytes | None:
    """The clip's frame with a box around who the model thinks is the player,
    for the coach's "Is this him?"."""
    if not frame_jpeg:
        return None
    img = cv2.imdecode(np.frombuffer(frame_jpeg, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    if box:
        h, w = img.shape[:2]
        try:
            x0, y0, x1, y1 = [float(v) for v in box]
            p0 = (int(max(0, min(x0, x1)) * w), int(max(0, min(y0, y1)) * h))
            p1 = (int(min(1, max(x0, x1)) * w), int(min(1, max(y0, y1)) * h))
            cv2.rectangle(img, p0, p1, (0, 200, 255), max(2, w // 240))
        except (TypeError, ValueError):
            pass
    return _jpeg(img, max_edge=640, quality=80)


def crop(frame_jpeg: bytes | None, box) -> bytes | None:
    """The player cut out of the frame (with some room around them), kept as a
    reference for the next tape."""
    if not frame_jpeg or not box:
        return None
    img = cv2.imdecode(np.frombuffer(frame_jpeg, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    h, w = img.shape[:2]
    try:
        x0, y0, x1, y1 = [float(v) for v in box]
    except (TypeError, ValueError):
        return None
    x0, x1 = sorted((max(0.0, min(1.0, x0)), max(0.0, min(1.0, x1))))
    y0, y1 = sorted((max(0.0, min(1.0, y0)), max(0.0, min(1.0, y1))))
    if x1 - x0 < 0.02 or y1 - y0 < 0.04:
        return None
    padx, pady = (x1 - x0) * 0.25, (y1 - y0) * 0.15
    a, b_ = int(max(0, x0 - padx) * w), int(max(0, y0 - pady) * h)
    c, d = int(min(1, x1 + padx) * w), int(min(1, y1 + pady) * h)
    piece = img[b_:d, a:c]
    return _jpeg(piece, max_edge=360, quality=85) if piece.size else None


def keep_events(events: list[dict], clips: list[dict]) -> list[dict]:
    """The logged actions that are the player's: inside a clip that is them,
    and (where the clip's number is known) under that number."""
    mine = [c for c in clips if c.get("final") == "yes"]
    out = []
    for e in events:
        t = e.get("t")
        if t is None:
            continue
        for c in mine:
            if c["start"] - 0.5 <= t <= c["end"] + 0.5 and (not c.get("no") or str(e.get("no")) == str(c["no"])):
                out.append(e)
                break
    return out


def identity_note(name: str, clips: list[dict]) -> str:
    """For the segment prompts: where the player is and what they wear, so the
    notes follow them across clips instead of whoever else is on screen."""
    mine = [c for c in clips if c.get("final") == "yes"]
    if not mine:
        return ""
    parts = []
    for c in mine[:40]:
        s, e = int(c["start"]), int(c["end"])
        wear = " ".join(x for x in (c.get("uni") or "", f"#{c['no']}" if c.get("no") else "") if x) or "their uniform"
        parts.append(f"{s//60:02d}:{s%60:02d}–{e//60:02d}:{e%60:02d} in {wear}")
    return (f" This is a highlight tape: {name} is the player to follow, in these clips only: "
            + "; ".join(parts) + ". Anyone else is context, not the subject.")
