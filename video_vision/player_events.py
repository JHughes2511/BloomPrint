"""Player-by-player events, logged while the film is watched.

A film analysis used to be prose about the TEAM: what sets were run, what
coverage was played. A coach scouting an opponent needs the other thing too —
#5 goes right, pulls up going left, never gets all the way to the rim — and
prose cannot be counted: "likes to go left" in one segment's notes and nothing
in the next is not a tendency, it is an impression.

So each segment, besides its notes, logs what individual players did in a
small fixed vocabulary, one line per action. The tallies are done later in
code (api/tendencies.py), not by the model, so "drives right 7 of 9" is a
count of seven logged drives and not a phrase the model liked.

Players are identified by uniform colour and jersey number, which is what the
film actually shows. Which team a colour is, is the coach's to say — see
directive().
"""
from __future__ import annotations

import json
import re

# ev -> allowed fields and their allowed values. Anything else is dropped, so
# a model inventing a category cannot put it into a count.
VOCAB: dict[str, dict[str, set[str]]] = {
    # Put the ball on the floor toward the rim.
    "drive":      {"dir": {"L", "R"},
                   "end": {"rim", "pull_up", "floater", "kick", "stopped"},
                   "res": {"made", "missed", "foul", "turnover", "pass", "none"}},
    # A shot that was not the end of a logged drive.
    "shot":       {"how": {"catch", "dribble"},
                   "zone": {"rim", "paint", "mid", "corner3", "wing3", "top3"},
                   "side": {"L", "R", "C"},
                   "res": {"made", "missed"}},
    # Ball screen, as the handler or the screener.
    "pnr":        {"role": {"handler", "screener"},
                   "read": {"use", "reject", "split", "pass", "shoot"},
                   "act": {"roll", "pop", "slip"}},
    # Back to the basket. dir is the shoulder turned over.
    "post":       {"dir": {"L", "R"}, "end": {"shot", "pass", "turnover"}},
    # Getting up and down the floor, and what set it off: running out after a
    # turnover is not the same habit as getting back after a make. "match" is
    # whether, getting back, the player picked someone up.
    "transition": {"effort": {"sprint", "jog"}, "way": {"offense", "defense"},
                   "after": {"turnover", "made", "miss", "rebound", "steal"},
                   "match": {"yes", "no"}},
    # Offense without the ball. "stand" is the stagnant one: standing and watching.
    "off_ball":   {"act": {"cut", "relocate", "screen", "stand"},
                   "res": {"scored", "open", "none"}},
    # Defense. "ball_watch" is the stagnant one: turned to the ball, man lost.
    "defense":    {"act": {"pressure", "gamble", "late_closeout", "good_closeout",
                           "help", "beaten", "foul", "steal", "block", "ball_watch"}},
}

MARKER = "PLAYER EVENTS:"


def directive(uniforms: dict[str, str] | None, colour_words: list[str] | None = None,
              focus: dict | None = None) -> str:
    """What each segment is asked to log, after its notes.

    `uniforms` is {colour: team name} from the coach. With it, the model is
    told the exact colour words to use, so matching back is exact. Without it
    but with the colours seen at upload (`colour_words`), those words are used,
    so a team put to a colour later still matches exactly. With neither, the
    model names the colours it sees and the coach confirms afterwards.
    """
    if uniforms:
        teams = "; ".join(f'"{c}" = {t}' for c, t in uniforms.items())
        uni_rule = (f'"uni" is the uniform colour, using EXACTLY one of these words: '
                    f'{", ".join(json.dumps(c) for c in uniforms)} ({teams}).')
    elif focus:
        uni_rule = f'"uni" is always {json.dumps(focus["uni"])} and "no" always {json.dumps(focus["no"])}.'
    elif colour_words:
        uni_rule = (f'"uni" is the uniform colour, using EXACTLY one of these words: '
                    f'{", ".join(json.dumps(c) for c in colour_words)}.')
    else:
        uni_rule = ('"uni" is the uniform colour as one or two plain words (e.g. "white", '
                    '"dark blue"), the SAME words every time for the same team.')
    who = ("INDIVIDUAL players" if not focus else
           f"ONE player — the one in {focus['uni']} #{focus['no']}, and nobody else")
    return (
        f"\n\nThen log what {who} did in these frames. After your notes, write a "
        f"line that says exactly {MARKER} and then ONE JSON array, nothing after it. One object "
        "per action you can actually see, in time order:\n"
        '{"t": "MM:SS", "uni": ..., "no": "<jersey number>", "ev": ..., ...fields}\n'
        f"{uni_rule} \"no\" is the jersey number as printed. If you cannot read the number, "
        "do not log the action — a guessed number puts one player's habits on another.\n"
        "Events and their fields (use only these words):\n"
        '- "drive": "dir" L|R (the way the player goes), "end" rim|pull_up|floater|kick|stopped, '
        '"res" made|missed|foul|turnover|pass|none\n'
        '- "shot" (not the end of a drive): "how" catch|dribble, "zone" rim|paint|mid|corner3|wing3|top3, '
        '"side" L|R|C, "res" made|missed\n'
        '- "pnr": "role" handler|screener; a handler has "read" use|reject|split|pass|shoot; '
        'a screener has "act" roll|pop|slip\n'
        '- "post": "dir" L|R (shoulder the player turns over), "end" shot|pass|turnover\n'
        '- "transition": "effort" sprint|jog, "way" offense|defense (running out on offense, or '
        'getting back on defense), "after" turnover|made|miss|rebound|steal (what started it), and on '
        'defense "match" yes|no (did the player pick someone up) — only when you see the player '
        "running (or not running) the floor\n"
        '- "off_ball": "act" cut|relocate|screen|stand ("stand" = standing and watching, '
        'stagnant), "res" scored|open|none\n'
        '- "defense": "act" pressure|gamble|late_closeout|good_closeout|help|beaten|foul|steal|'
        'block|ball_watch ("ball_watch" = turned to the ball, lost their player — stagnant)\n'
        "L and R are the PLAYER's left and right, facing the basket they attack. Log only what "
        "the frames show; an empty array is a correct answer for frames with nothing clear."
    )


def events_only_prompt(uniforms: dict[str, str] | None, colour_words: list[str] | None = None,
                       focus: dict | None = None) -> str:
    """For a short film read in one pass: no segment notes to hang the log on."""
    return ("Watch these frames of game film and log individual players' actions. Write no "
            "notes: only the line and the array described below." + directive(uniforms, colour_words, focus))


COLOURS_PROMPT = (
    "These frames are from one basketball game. What colour is each team's uniform? Reply with "
    'only JSON: {"colours": ["<one team>", "<the other team>"]}, each one or two plain lowercase '
    'words (e.g. "white", "dark blue"). Referees are not a team.'
)


def detect_colours(video_path: str, ask) -> list[str]:
    """The two uniform colours in a film, from a handful of frames across it.

    Asked as the film goes up, so the coach picks "Duke wore white" from what
    the film shows instead of typing it. `ask(content) -> str` is the model
    call. An empty list when the film cannot be read or the answer is unclear.
    """
    import base64
    import cv2
    cap = cv2.VideoCapture(video_path)
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total <= 0:
            return []
        content: list[dict] = [{"type": "text", "text": COLOURS_PROMPT}]
        for k in range(1, 9):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * k / 9))
            ok, frame = cap.read()
            if not ok:
                continue
            h, w = frame.shape[:2]
            scale = min(1.0, 768 / max(w, 1))
            if scale < 1.0:
                frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ok:
                content.append({"type": "image", "source": {
                    "type": "base64", "media_type": "image/jpeg",
                    "data": base64.b64encode(buf.tobytes()).decode()}})
    finally:
        cap.release()
    if len(content) < 3:
        return []
    m = re.search(r"\{.*\}", ask(content) or "", re.S)
    try:
        colours = json.loads(m.group(0)).get("colours") if m else None
    except ValueError:
        return []
    out = []
    for c in colours or []:
        c = " ".join(str(c or "").lower().split())[:40]
        if c and c not in out:
            out.append(c)
    return out[:2] if len(out) == 2 else []


def _ts_seconds(t) -> int | None:
    m = re.match(r"^\s*(\d{1,3}):(\d{2})\s*$", str(t or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def clean(raw) -> dict | None:
    """One logged action, kept only if it is in the vocabulary."""
    if not isinstance(raw, dict):
        return None
    ev = str(raw.get("ev") or "").strip().lower()
    if ev not in VOCAB:
        return None
    no = re.sub(r"[^0-9]", "", str(raw.get("no") or ""))
    uni = re.sub(r"\s+", " ", str(raw.get("uni") or "").strip().lower())[:40]
    if not no or len(no) > 3 or not uni:
        return None
    out: dict = {"ev": ev, "no": str(int(no)) if no != "00" else "00", "uni": uni,
                 "t": _ts_seconds(raw.get("t"))}
    for field, allowed in VOCAB[ev].items():
        v = raw.get(field)
        if v is None:
            continue
        v = str(v).strip()
        v = v.upper() if v.upper() in allowed else v.lower()
        if v in allowed:
            out[field] = v
    return out


def split(note: str) -> tuple[str, list[dict]]:
    """A segment's reply as (its notes, its events). No marker: all notes."""
    if not note or MARKER not in note:
        return note or "", []
    head, _, tail = note.rpartition(MARKER)
    # The array, allowing for a ```json fence around it.
    m = re.search(r"\[.*\]", tail, re.S)
    events: list[dict] = []
    if m:
        try:
            parsed = json.loads(m.group(0))
            if isinstance(parsed, list):
                events = [e for e in (clean(x) for x in parsed) if e]
        except (ValueError, TypeError):
            events = []
    return head.rstrip().rstrip("`").rstrip(), events
