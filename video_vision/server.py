"""BloomPrint Video Vision MCP Server.

Exposes tools for extracting and analyzing video frames via Claude's vision API,
transcribing audio via Deepgram, and basketball-specific analysis via the
Basketball Intelligence Model (BIM).
"""

import base64
import os
import time
import pathlib
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import anthropic
import cv2
import numpy as np
from PIL import Image

# The MCP surface is OPTIONAL.
#
# This module is two things: the analysis itself, which the API calls directly,
# and a thin MCP server that exposes the same functions to an MCP client. Only
# the second needs the mcp package — but importing it at the top made the whole
# module unimportable when the installed mcp exposes a different Server API, and
# the coach saw "'Server' object has no attribute 'list_tools'" the moment they
# analyzed a film. The API must not be able to fail on a dependency it does not
# use, so the MCP pieces degrade to no-ops instead.
try:                                                   # pragma: no cover
    import mcp.server.stdio                            # noqa: F401
    import mcp.types as types
    from mcp.server import Server

    app = Server("video-vision")
    _MCP_ERROR: Exception | None = None
    if not hasattr(app, "list_tools") or not hasattr(app, "call_tool"):
        raise AttributeError("installed mcp Server has no list_tools/call_tool")
except Exception as _exc:                              # pragma: no cover
    _MCP_ERROR = _exc

    class _TextContent:
        """Stands in for mcp.types.TextContent — the analysis returns these."""

        def __init__(self, type: str = "text", text: str = "") -> None:
            self.type, self.text = type, text

    class _Types:
        TextContent = _TextContent
        Tool = dict

    types = _Types()                                   # type: ignore[assignment]

    class _NoServer:
        """Accepts the decorators and registers nothing."""

        def __init__(self, *a: Any, **k: Any) -> None:
            pass

        def list_tools(self):
            return lambda fn: fn

        def call_tool(self):
            return lambda fn: fn

    app = _NoServer("video-vision")                    # type: ignore[assignment]

from .bim import build_prompt, OUTPUT_TYPES, COACH_WEIGHTS, COMPETITION_LEVELS
from api.ai_models import OPUS, text_of
from api import speech

_anthropic_client: anthropic.Anthropic | None = None


def _client() -> anthropic.Anthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic()
    return _anthropic_client


def _writing_hook(progress):
    """Turn a job's progress callback into the one `_long_answer` wants.

    Reported as a percentage, the same as the pre-scan — a word count is a
    number the coach has no yardstick for ("is 1,200 nearly done?").

    There is no true total to divide by: the report ends when it ends. The first
    attempt at this saturated from the very first word, which put 90% at 3,600
    words and then needed another 450 to reach 91 — so the number sat still for
    the whole tail of a long report and looked stuck. It climbs steadily to 90%
    across a full-length report instead, and only then eases off, so a report
    that runs long keeps moving rather than parking.

    The shape of this code is a wire format, and the app that reads it is a
    browser tab that may have been loaded before this deploy. A heartbeat was
    briefly appended here as a third field, and the already-loaded app — which
    only knew two — fell through to printing the raw "job:writing:90:28" at a
    coach. Anything added here has to be readable by the version already out
    there, so the percentage alone it stays: it moves at least every few
    seconds, which is the same liveness signal the heartbeat was for.
    """
    if not progress:
        return None

    FULL = 3000   # words in a full report; most finish around here
    TAIL = 300    # words per point beyond that — a tick every few seconds

    def report(words: int) -> None:
        if words <= FULL:
            pct = round(90 * words / FULL)
        else:
            # Past a full report we are guessing, so move at a fixed, visible
            # rate rather than an ever-slowing one. Holding at 99 for the last
            # of a very long report is a far smaller lie than sitting on 90 for
            # all of it.
            pct = min(99, 90 + (words - FULL) // TAIL)
        try:
            progress(1, 1, f"job:writing:{pct}")
        except Exception:
            pass

    return report


def _long_answer(messages: list[dict], max_tokens: int, on_words=None) -> str:
    """One long completion, streamed.

    A non-streaming request carries a ten-minute ceiling: the SDK abandons it at
    600s and silently retries twice, so a synthesis that ran long showed the
    same frozen progress label for half an hour and then failed — after paying
    for the work three times. Writing a full game report from thirty segments
    of notes is exactly the call that runs long. Streaming has no such ceiling.

    It also makes the phase visible. The old code sent "job:synthesizing" once
    and then said nothing for however long the report took, which is
    indistinguishable from a dead process — to the coach watching it, and to
    the client's stall detector, which gives up after 25 minutes of a progress
    label that has not changed. `on_words` is called as the text arrives, so
    the last phase of a long film reports itself like every other phase.
    """
    out: list[str] = []
    words = 0
    told = 0
    # A ceiling on SILENCE, not on the call: each read may wait this long, so a
    # report that legitimately takes half an hour is fine, while a connection
    # that dies mid-stream raises instead of holding the job open forever with
    # a progress bar that will never move again.
    with _client().messages.stream(model=OPUS, max_tokens=max_tokens, messages=messages,
                                   timeout=300.0) as stream:
        for chunk in stream.text_stream:
            out.append(chunk)
            if on_words is None:
                continue
            words += chunk.count(" ")
            # Every ~100 words, not every token: this writes a database row.
            if words - told >= 100:
                told = words
                try:
                    on_words(words)
                except Exception:
                    pass
    return "".join(out)




# A segment that fails gets another go before it is written off. A film's worth
# of segment calls runs for the best part of an hour, so a rate limit or a
# dropped connection somewhere in the middle is ordinary, not exceptional.
SEGMENT_TRIES = 3
SEGMENT_BACKOFF = 4.0   # seconds, doubled each retry


def _permanent(exc: Exception) -> bool:
    """Is this a failure that trying again cannot fix?

    A rate limit or a dropped connection clears on its own; an exhausted
    credit balance, a bad key or a revoked permission does not. Treating them
    alike meant a billing problem was retried three times per segment across
    twenty segments — sixty doomed calls and minutes of backoff — before the
    coach was told the one thing they needed to know.
    """
    code = getattr(exc, "status_code", None)
    if code in (400, 401, 403, 404):
        return True
    text = str(exc).lower()
    return any(s in text for s in (
        "credit balance", "invalid_request_error", "authentication_error",
        "permission_error", "invalid x-api-key",
    ))

# How much of a film may go unwatched before the report stops being worth
# writing. Below this the report is honest about what it covers; above it, a
# confident summary of a game the model mostly did not see is worse than an
# error a coach can act on.
MAX_MISSING_FRACTION = 0.25

# The longest edge we keep on a sampled frame.
#
# Vision models downsample anything larger before they look at it, so a 4K
# frame costs memory and upload time to deliver detail that is thrown away.
# 1280 keeps a 16:9 frame just under a megapixel, which is inside that budget
# and still shows jersey numbers on a wide shot.
FRAME_MAX_EDGE = 1280

# JPEG quality for a sampled frame. 80 is visually indistinguishable from 85 on
# film stills and about 20% smaller across 800 of them.
FRAME_JPEG_QUALITY = 80


def _encode_frame(frame: np.ndarray) -> bytes:
    """A decoded frame as compressed JPEG bytes, downscaled to what the model uses.

    Extraction used to hand back raw BGR arrays and the whole sample was held
    until the report was written. A 1080p frame is 6 MB decoded and a full game
    samples 800 of them: about 5 GB, which the container does not have. The
    process was killed part-way through the segment loop, which is what a long
    film failing at 14% looks like from outside. The same frames as JPEG are
    roughly 100 KB each — the sample fits in a hundred megabytes and the upload
    for each segment shrinks with it.
    """
    h, w = frame.shape[:2]
    longest = max(h, w)
    if longest > FRAME_MAX_EDGE:
        scale = FRAME_MAX_EDGE / longest
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), FRAME_JPEG_QUALITY])
    if not ok:
        # Fall back to the Pillow path rather than lose the frame.
        img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            img.save(tmp.name, format="JPEG", quality=FRAME_JPEG_QUALITY)
            tmp_path = tmp.name
        try:
            return pathlib.Path(tmp_path).read_bytes()
        finally:
            os.unlink(tmp_path)
    return buf.tobytes()


def _frame_to_base64(frame) -> str:
    """Base64 for the API. Accepts an already-encoded frame or a raw array."""
    data = frame if isinstance(frame, (bytes, bytearray)) else _encode_frame(frame)
    return base64.standard_b64encode(data).decode("utf-8")


def _extract_frames(
    video_path: str,
    interval_seconds: float = 1.0,
    max_frames: int = 16,
) -> list[tuple[float, bytes]]:
    """Return (timestamp_seconds, frame) pairs sampled from the video."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps

    step = max(interval_seconds, duration / max_frames) if duration > 0 else interval_seconds
    timestamps: list[float] = []
    t = 0.0
    while t <= duration and len(timestamps) < max_frames:
        timestamps.append(t)
        t += step

    results: list[tuple[float, bytes]] = []
    for ts in timestamps:
        cap.set(cv2.CAP_PROP_POS_MSEC, ts * 1000)
        ret, frame = cap.read()
        if ret:
            results.append((ts, _encode_frame(frame)))

    cap.release()
    return results


def _extract_frames_interval(
    video_path: str,
    interval_seconds: float,
    total_cap: int,
) -> list[tuple[float, bytes]]:
    """Sample one frame every `interval_seconds` across the WHOLE video (so
    coverage is proportional to length), capped at `total_cap` frames."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps else 0.0
    if duration <= 0:
        cap.release()
        return _extract_frames(video_path, interval_seconds, min(total_cap, 20))

    n = int(duration / max(interval_seconds, 0.5)) + 1
    if n > total_cap:                       # too many — widen the interval to fit
        interval_seconds = duration / total_cap
        n = total_cap
    results: list[tuple[float, bytes]] = []
    t = 0.0
    while t <= duration and len(results) < total_cap:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ret, frame = cap.read()
        if ret:
            results.append((t, _encode_frame(frame)))
        t += interval_seconds
    cap.release()
    return results


# ── Adaptive, motion-aware sampling ───────────────────────────────────────────
# Sample densely during action and sparsely during dead time, scaling the frame
# budget to the film's length. A cheap local pre-scan scores per-timestamp motion
# (and scene cuts); the budget is spent where the basketball is.

def _frame_budget(duration: float) -> int:
    """Frames to spend on a film, scaled by length with a sane max. Short clips
    get near-1fps; full games are capped and rely on motion-gating."""
    if duration <= 0:
        return 60
    if duration <= 120:          # short clip / single possession → near-exhaustive
        return min(int(duration) + 12, 160)
    if duration <= 900:          # up to 15 min → dense on action
        return min(int(duration * 0.55), 460)
    return 800                   # full game / half → sane max, motion-gated


def _floor_interval(duration: float) -> float:
    """Guaranteed baseline: at least one frame every N seconds even in dead time."""
    if duration <= 120:
        return 4.0
    if duration <= 900:
        return 8.0
    return 15.0


def _motion_profile(video_path: str, on_progress=None) -> tuple[float, list[tuple[float, float]]]:
    """Cheap pass: return (duration, [(timestamp, motion_score)]). Motion score is
    the mean abs frame-to-frame difference on a tiny grayscale thumbnail.

    "Cheap" is relative to analysing the film, not to nothing: every step is a
    seek and a decode, so the count is what matters. A three-hour film at a
    two-second step is 5,400 of them, which is minutes of work on a small
    container with no sign of life for the coach watching — see on_progress.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total / fps if fps else 0.0
    if duration <= 0:
        cap.release()
        return 0.0, []
    # Coarser scan for longer film so the scan itself stays fast. Beyond an hour
    # the step widens again: past that length the pre-scan, not the analysis,
    # becomes the longest part of the job, and the sampling it feeds is picking
    # a few hundred frames out of hours — a four-second grid is ample for that.
    scan_step = (
        0.5 if duration <= 300
        else 1.0 if duration <= 1800
        else 2.0 if duration <= 3600
        else 4.0
    )
    scores: list[tuple[float, float]] = []
    prev = None
    t = 0.0
    last_pct = -1
    while t <= duration:
        if on_progress:
            pct = int(t / duration * 100)
            # Only on change: this loop runs thousands of times and each report
            # is a database write.
            if pct != last_pct:
                last_pct = pct
                try:
                    on_progress(pct)
                except Exception:
                    pass
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ret, frame = cap.read()
        if not ret:
            t += scan_step
            continue
        small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (48, 48))
        score = 0.0 if prev is None else float(np.mean(cv2.absdiff(small, prev)))
        scores.append((round(t, 2), score))
        prev = small
        t += scan_step
    cap.release()
    return duration, scores


def _select_adaptive_timestamps(duration: float, scores: list[tuple[float, float]], budget: int) -> list[float]:
    """Pick which timestamps to actually analyze: a baseline floor everywhere,
    every scene cut / motion burst, then the highest-motion moments until the
    budget is spent."""
    if not scores:
        return []
    vals = sorted(s for _, s in scores)
    median = vals[len(vals) // 2] if vals else 0.0
    cut_threshold = max(median * 3.0, 8.0)   # a spike vs the film's own baseline
    floor_int = _floor_interval(duration)

    chosen: set[float] = set()
    t = 0.0
    while t <= duration:                     # guaranteed baseline coverage
        chosen.add(round(t, 1))
        t += floor_int
    for ts, s in scores:                     # every scene cut / motion burst
        if s >= cut_threshold:
            chosen.add(round(ts, 1))
    for ts, s in sorted(scores, key=lambda x: x[1], reverse=True):  # spend rest on action
        if len(chosen) >= budget:
            break
        chosen.add(round(ts, 1))
    return sorted(chosen)[:budget]


def _extract_frames_adaptive(video_path: str, budget_cap: int | None = None,
                             on_progress=None, profile=None,
                             on_profile=None) -> list[tuple[float, bytes]]:
    """Motion-aware frame extraction: pre-scan for motion, then grab full-res
    frames at the selected timestamps.

    `profile` is a pre-scan from an earlier attempt. The scan is thousands of
    seeks and by far the longest part of a long film — and it produces a few
    hundred numbers. Keeping those meant a server restart at 99% did not throw
    away the hour it took to read the film.
    """
    if profile and profile.get("scores"):
        duration = float(profile.get("duration") or 0.0)
        scores = [(float(t), float(v)) for t, v in profile["scores"]]
    else:
        duration, scores = _motion_profile(video_path, on_progress=on_progress)
        if on_profile and duration > 0 and scores:
            try:
                on_profile({"duration": duration, "scores": [[t, v] for t, v in scores]})
            except Exception:
                pass
    if duration <= 0 or not scores:
        return _extract_frames_interval(video_path, 4.0, budget_cap or 200)
    budget = _frame_budget(duration)
    if budget_cap:
        budget = min(budget, budget_cap)
    stamps = _select_adaptive_timestamps(duration, scores, budget)
    cap = cv2.VideoCapture(video_path)
    out: list[tuple[float, bytes]] = []
    for ts in stamps:
        cap.set(cv2.CAP_PROP_POS_MSEC, ts * 1000)
        ret, frame = cap.read()
        if ret:
            out.append((ts, _encode_frame(frame)))
    cap.release()
    return out


# How much film audio is worth transcribing before we skip it even when speech
# is present. The old 10-minute cap was a CPU-Whisper limit — a full game took
# longer to transcribe than to watch. Deepgram runs far faster than real time,
# so a whole game's audio is now affordable and a coach's second-half comments
# stop being invisible to the analysis. The local fallback keeps the old cap,
# because on that path the old reason still holds.
AUDIO_MAX_SECONDS = 3600 if speech.deepgram_enabled() else 600


def _audio_is_useful(video_path: str) -> bool:
    """Gauge, as part of the pre-scan, whether the film has speech worth
    transcribing: probe the first 90s — reject near-silence, then confirm the
    probe yields real words (commentary/coaching), not just crowd noise."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        probe = tmp.name
    try:
        res = subprocess.run(
            ["ffmpeg", "-y", "-t", "90", "-i", video_path,
             "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", probe],
            capture_output=True, text=True,
        )
        if res.returncode != 0 or not Path(probe).exists() or Path(probe).stat().st_size < 4000:
            return False
        # Energy gate — skip near-silent tracks cheaply.
        try:
            import wave
            with wave.open(probe, "rb") as w:
                frames = w.readframes(w.getnframes())
            samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
            if samples.size == 0:
                return False
            rms = float(np.sqrt(np.mean(samples ** 2)))
            if rms < 250:            # essentially silence / faint hum
                return False
        except Exception:
            pass
        # Confirm it's actually speech by transcribing the short probe.
        try:
            out = speech.transcribe_file(probe, keyterms=speech.BASKETBALL_TERMS, timeout=90.0)
            return len((out.get("text") or "").split()) >= 15
        except Exception:
            return False
    finally:
        if Path(probe).exists():
            os.unlink(probe)


def _extract_audio(video_path: str, out_path: str) -> bool:
    """Extract audio track from video to a WAV file using ffmpeg. Returns False if no audio."""
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", video_path,
            "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            out_path,
        ],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and Path(out_path).exists() and Path(out_path).stat().st_size > 0


def _transcribe(video_path: str, model_name: str = "") -> dict[str, Any]:
    """Extract the audio track, then transcribe it. Returns Whisper's result shape.

    `model_name` is accepted and ignored — it was a Whisper size ("tiny".."large")
    and the tool schema still exposes it, so callers that pass one keep working.
    """
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        audio_path = tmp.name
    try:
        if not _extract_audio(video_path, audio_path):
            return {"text": "", "segments": [], "language": "unknown"}
        return speech.transcribe_file(audio_path, keyterms=speech.BASKETBALL_TERMS)
    finally:
        if Path(audio_path).exists():
            os.unlink(audio_path)


def _format_segments(segments: list[dict]) -> str:
    lines = []
    for seg in segments:
        start = seg.get("start", 0.0)
        end = seg.get("end", 0.0)
        text = seg.get("text", "").strip()
        lines.append(f"  [{start:.1f}s → {end:.1f}s] {text}")
    return "\n".join(lines)


@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="extract_frames",
            description=(
                "Extract frames from a local video file at regular intervals. "
                "Returns metadata about each extracted frame (timestamp, index)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "video_path": {
                        "type": "string",
                        "description": "Absolute path to the video file.",
                    },
                    "interval_seconds": {
                        "type": "number",
                        "description": "Seconds between sampled frames (default 1.0).",
                        "default": 1.0,
                    },
                    "max_frames": {
                        "type": "integer",
                        "description": "Maximum number of frames to extract (default 16, max 64).",
                        "default": 16,
                    },
                },
                "required": ["video_path"],
            },
        ),
        types.Tool(
            name="analyze_frame",
            description=(
                "Analyze a single frame from a video at a specific timestamp using Claude's vision API."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "video_path": {
                        "type": "string",
                        "description": "Absolute path to the video file.",
                    },
                    "timestamp_seconds": {
                        "type": "number",
                        "description": "Timestamp (in seconds) of the frame to analyze.",
                    },
                    "prompt": {
                        "type": "string",
                        "description": "Question or instruction for Claude about this frame.",
                        "default": "Describe what you see in this frame.",
                    },
                },
                "required": ["video_path", "timestamp_seconds"],
            },
        ),
        types.Tool(
            name="analyze_video",
            description=(
                "Analyze an entire video by sampling frames and optionally transcribing audio, "
                "then asking Claude a question about the combined content."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "video_path": {
                        "type": "string",
                        "description": "Absolute path to the video file.",
                    },
                    "prompt": {
                        "type": "string",
                        "description": "Question or instruction for Claude about the video.",
                        "default": "Describe what happens in this video.",
                    },
                    "interval_seconds": {
                        "type": "number",
                        "description": "Seconds between sampled frames (default 2.0).",
                        "default": 2.0,
                    },
                    "max_frames": {
                        "type": "integer",
                        "description": "Maximum frames to sample (default 8, max 20).",
                        "default": 8,
                    },
                    "include_audio": {
                        "type": "boolean",
                        "description": "Transcribe audio and include it as context (default true).",
                        "default": True,
                    },
                    "whisper_model": {
                        "type": "string",
                        "description": "Deprecated and ignored — transcription no longer uses a local model size.",
                        "default": "base",
                    },
                },
                "required": ["video_path"],
            },
        ),
        types.Tool(
            name="transcribe_audio",
            description=(
                "Transcribe the audio track of a video file. "
                "Returns the full transcript with per-segment timestamps."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "video_path": {
                        "type": "string",
                        "description": "Absolute path to the video file.",
                    },
                    "model": {
                        "type": "string",
                        "description": "Deprecated and ignored — transcription no longer uses a local model size.",
                        "default": "base",
                    },
                    "language": {
                        "type": "string",
                        "description": "ISO language code hint (e.g. 'en', 'fr'). Omit for auto-detection.",
                    },
                },
                "required": ["video_path"],
            },
        ),
        types.Tool(
            name="analyze_basketball_video",
            description=(
                "Analyze a basketball video using the Basketball Intelligence Model (BIM). "
                "Produces one of 8 structured output types: film_breakdown, player_eval, "
                "scouting_report, coaching_report, training_program, recruitment_profile, "
                "position_analysis, or game_analysis. Frames are sampled and optionally "
                "transcribed before being sent to Claude with the BIM prompt."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "video_path": {
                        "type": "string",
                        "description": "Absolute path to the video file.",
                    },
                    "output_type": {
                        "type": "string",
                        "enum": OUTPUT_TYPES,
                        "description": (
                            "Report type to generate. One of: "
                            + ", ".join(OUTPUT_TYPES)
                        ),
                    },
                    "program_name": {
                        "type": "string",
                        "description": "Name of the program using the model (e.g. 'SEED Academy').",
                        "default": "SEED Academy",
                    },
                    "competition_level": {
                        "type": "string",
                        "description": (
                            "Level of play in the footage. One of: "
                            + ", ".join(COMPETITION_LEVELS)
                        ),
                        "default": "16U AAU",
                    },
                    "coach_weight": {
                        "type": "integer",
                        "description": (
                            "Authority weight of the requesting coach (1–100). "
                            "Approximate values — NBA: 98, D1 head: 75, HS/elite AAU: 45, youth: 25."
                        ),
                        "default": 45,
                    },
                    "player_name": {
                        "type": "string",
                        "description": "Player name to focus on (optional — omit for team/full-game analysis).",
                    },
                    "focus_prompt": {
                        "type": "string",
                        "description": "Optional additional question or coaching focus to append to the BIM prompt.",
                    },
                    "interval_seconds": {
                        "type": "number",
                        "description": "Seconds between sampled frames (default 2.0).",
                        "default": 2.0,
                    },
                    "max_frames": {
                        "type": "integer",
                        "description": "Maximum frames to sample (default 10, max 20).",
                        "default": 10,
                    },
                    "include_audio": {
                        "type": "boolean",
                        "description": "Transcribe audio and include as context (default true).",
                        "default": True,
                    },
                    "whisper_model": {
                        "type": "string",
                        "description": "Deprecated and ignored — transcription no longer uses a local model size.",
                        "default": "base",
                    },
                },
                "required": ["video_path", "output_type"],
            },
        ),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[types.TextContent]:
    if name == "extract_frames":
        return await _handle_extract_frames(arguments)
    if name == "analyze_frame":
        return await _handle_analyze_frame(arguments)
    if name == "analyze_video":
        return await _handle_analyze_video(arguments)
    if name == "transcribe_audio":
        return await _handle_transcribe_audio(arguments)
    if name == "analyze_basketball_video":
        return await _handle_analyze_basketball_video(arguments)
    raise ValueError(f"Unknown tool: {name}")


async def _handle_extract_frames(args: dict[str, Any]) -> list[types.TextContent]:
    video_path = args["video_path"]
    interval = float(args.get("interval_seconds", 1.0))
    max_frames = min(int(args.get("max_frames", 16)), 64)

    if not Path(video_path).exists():
        return [types.TextContent(type="text", text=f"Error: file not found: {video_path}")]

    frames = _extract_frames(video_path, interval, max_frames)
    lines = [f"Extracted {len(frames)} frames from {video_path}:", ""]
    for i, (ts, _) in enumerate(frames):
        lines.append(f"  Frame {i}: {ts:.2f}s")

    return [types.TextContent(type="text", text="\n".join(lines))]


async def _handle_analyze_frame(args: dict[str, Any]) -> list[types.TextContent]:
    video_path = args["video_path"]
    ts = float(args["timestamp_seconds"])
    prompt = args.get("prompt", "Describe what you see in this frame.")

    if not Path(video_path).exists():
        return [types.TextContent(type="text", text=f"Error: file not found: {video_path}")]

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return [types.TextContent(type="text", text=f"Error: cannot open video: {video_path}")]

    cap.set(cv2.CAP_PROP_POS_MSEC, ts * 1000)
    ret, frame = cap.read()
    cap.release()

    if not ret:
        return [types.TextContent(type="text", text=f"Error: could not read frame at {ts}s")]

    img_b64 = _frame_to_base64(frame)
    response = _client().messages.create(
        model=OPUS,
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/jpeg", "data": img_b64},
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )
    answer = text_of(response)
    return [types.TextContent(type="text", text=f"[Frame at {ts:.2f}s]\n{answer}")]


async def _handle_transcribe_audio(args: dict[str, Any]) -> list[types.TextContent]:
    video_path = args["video_path"]
    language = args.get("language")

    if not Path(video_path).exists():
        return [types.TextContent(type="text", text=f"Error: file not found: {video_path}")]

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        audio_path = tmp.name
    try:
        if not _extract_audio(video_path, audio_path):
            return [types.TextContent(type="text", text="Error: no audio track found or ffmpeg unavailable.")]
        result = speech.transcribe_file(
            audio_path, language=language, keyterms=speech.BASKETBALL_TERMS
        )
    except speech.SpeechUnavailable as e:
        return [types.TextContent(type="text", text=f"Error: {e}")]
    finally:
        if Path(audio_path).exists():
            os.unlink(audio_path)

    transcript = result.get("text", "").strip()
    segments = result.get("segments", [])
    detected_lang = result.get("language", "unknown")

    lines = [
        f"Transcription of: {video_path}",
        f"Detected language: {detected_lang}",
        f"{'─' * 60}",
        "",
        transcript,
        "",
        "Segments:",
        _format_segments(segments),
    ]
    return [types.TextContent(type="text", text="\n".join(lines))]


async def _handle_analyze_video(args: dict[str, Any]) -> list[types.TextContent]:
    video_path = args["video_path"]
    prompt = args.get("prompt", "Describe what happens in this video.")
    interval = float(args.get("interval_seconds", 2.0))
    max_frames = min(int(args.get("max_frames", 8)), 20)
    include_audio = bool(args.get("include_audio", True))

    if not Path(video_path).exists():
        return [types.TextContent(type="text", text=f"Error: file not found: {video_path}")]

    frames = _extract_frames(video_path, interval, max_frames)
    if not frames:
        return [types.TextContent(type="text", text="Error: no frames could be extracted.")]

    transcript_text = ""
    if include_audio:
        try:
            result = _transcribe(video_path)
            transcript_text = result.get("text", "").strip()
        except Exception:
            transcript_text = ""

    content: list[dict] = []

    if transcript_text:
        content.append({
            "type": "text",
            "text": f"Audio transcript:\n{transcript_text}\n\nVideo frames:",
        })

    for ts, frame in frames:
        content.append({"type": "text", "text": f"[Frame at {ts:.2f}s]"})
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": _frame_to_base64(frame),
            },
        })

    content.append({"type": "text", "text": prompt})

    response = _client().messages.create(
        model=OPUS,
        max_tokens=8192,
        messages=[{"role": "user", "content": content}],
    )
    answer = text_of(response)

    audio_note = " + audio transcript" if transcript_text else ""
    header = f"Video analysis ({len(frames)} frames{audio_note}): {video_path}\n{'─' * 60}\n"
    return [types.TextContent(type="text", text=header + answer)]


async def _handle_analyze_basketball_video(args: dict[str, Any]) -> list[types.TextContent]:
    # Accept one video ("video_path") OR several ("video_paths"); multiple films
    # are combined into a single frame set so ONE report covers all of them.
    video_paths = args.get("video_paths") or ([args.get("video_path")] if args.get("video_path") else [])
    video_paths = [p for p in video_paths if p and Path(p).exists()]
    video_path = video_paths[0] if video_paths else args.get("video_path")
    output_type = args["output_type"]
    program = args.get("program_name", "SEED Academy")
    level = args.get("competition_level", "16U AAU")
    coach_weight = int(args.get("coach_weight", 45))
    player_name = args.get("player_name", "")
    focus_prompt = args.get("focus_prompt", "")
    interval = float(args.get("interval_seconds", 2.0))
    max_frames = min(int(args.get("max_frames", 10)), 20)
    include_audio = bool(args.get("include_audio", True))

    if not video_paths:
        return [types.TextContent(type="text", text=f"Error: file not found: {video_path}")]

    try:
        bim_prompt = build_prompt(output_type, program, level, coach_weight, player_name)
    except ValueError as e:
        return [types.TextContent(type="text", text=f"Error: {e}")]

    # Player evals request a tailored ADDITIONAL FOCUS output section; clip
    # analyses just get the focus as plain context.
    if args.get("additional_focus"):
        from .bim import additional_focus_directive
        bim_prompt += additional_focus_directive(focus_prompt)
    elif focus_prompt:
        bim_prompt += f"\n\nADDITIONAL FOCUS:\n{focus_prompt}"

    # Interval sampling: one frame every `interval` seconds across the WHOLE film
    # so a 6-min and a 60-min clip get the same per-minute coverage. For long
    # films we analyze in chunks (map) and synthesize one report (reduce).
    CHUNK = 40
    TOTAL_CAP = 900          # absolute safety ceiling across all films
    progress = args.get("_progress")   # optional callable(done, total, label)
    # Segments finished by an earlier attempt, and the hook that records each
    # one as it lands. A film analysis is twenty Opus calls over twenty minutes,
    # and the process running it can be replaced by a deploy at any point; with
    # these the next attempt pays only for what is left instead of starting the
    # film again. Sampling is deterministic for a given file, so segment i means
    # the same frames on every run.
    resume_notes: dict = args.get("_resume_notes") or {}
    on_segment = args.get("_on_segment")   # optional callable(index, text)
    # Progress labels are stable machine codes ("job:scanning", "job:segment:i:n",
    # "job:synthesizing"), not prose — the client renders them in the coach's
    # language. Changing a code without updating jobProgressLabel() in the app
    # will surface the raw code to the user.
    # Motion-aware sampling: dense on action, sparse on dead time, budget scaled
    # by each film's length. Split the absolute ceiling across multiple films.
    per_cap = max(60, TOTAL_CAP // max(len(video_paths), 1))
    if progress:
        try:
            progress(0, 1, "job:scanning")
        except Exception:
            pass
    # A pre-scan kept from an earlier attempt, and the hook that saves a new
    # one. Keyed by position, because sampling is deterministic per file.
    resume_profiles: dict = args.get("_resume_profiles") or {}
    on_profile = args.get("_on_profile")

    frames = []
    for i, p in enumerate(video_paths):
        # A long film spends minutes here before the first segment. Reporting
        # the scan's own percentage is what tells the coach it is working, and
        # what tells the app the job is alive rather than wedged.
        def _scan_progress(pct: int, _p=p):
            if progress:
                try:
                    progress(0, 1, f"job:scanning:{pct}")
                except Exception:
                    pass

        def _save_profile(prof, _i=i):
            if on_profile:
                try:
                    on_profile(_i, prof)
                except Exception:
                    pass

        frames += _extract_frames_adaptive(
            p, budget_cap=per_cap, on_progress=_scan_progress,
            profile=resume_profiles.get(i) or resume_profiles.get(str(i)),
            on_profile=_save_profile,
        )
    frames = frames[:TOTAL_CAP]
    if not frames:
        return [types.TextContent(type="text", text="Error: no frames could be extracted.")]

    transcript_text = ""
    # Audio: gauge whether it's worth transcribing (part of the pre-scan). Only
    # for a single film whose audio is short enough to be worth transcribing.
    duration_guess = frames[-1][0] if frames else 0.0
    want_audio = include_audio
    if args.get("audio_auto") and len(video_paths) == 1:
        want_audio = duration_guess <= AUDIO_MAX_SECONDS and _audio_is_useful(video_path)
    if want_audio and len(video_paths) == 1:
        try:
            result = _transcribe(video_path)
            transcript_text = result.get("text", "").strip()
        except Exception:
            transcript_text = ""

    def _fmt_ts(ts: float) -> str:
        ts = max(int(round(ts)), 0)
        return f"{ts // 60:02d}:{ts % 60:02d}"

    def _frames_content(fr):
        c = [{"type": "text", "text": (
            "\nVIDEO FRAMES (each is labeled with its film timestamp [MM:SS]). "
            "When you reference a specific moment, play, or action, cite the film "
            "timestamp like (12:34). NEVER write 'Frame' followed by a number "
            "(e.g. 'Frame 60', 'Frame 132') and never use raw seconds or a 'KEY "
            "FRAMES LOGGED' list — frame numbers mean nothing to a coach. If a "
            "scoreboard/game clock and score are visible in the frame, you may cite "
            "those instead (e.g. 'Q3 4:12, 45-40')."
        )}]
        for ts, frame in fr:
            c.append({"type": "text", "text": f"[{_fmt_ts(ts)}]"})
            c.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": _frame_to_base64(frame)}})
        return c

    # ── Single pass (short clips) ──
    if len(frames) <= CHUNK:
        content: list[dict] = [{"type": "text", "text": bim_prompt}]
        if transcript_text:
            content.append({"type": "text", "text": f"\nAUDIO TRANSCRIPT FROM VIDEO:\n{transcript_text}\n"})
        content += _frames_content(frames)
        answer = _long_answer([{"role": "user", "content": content}], 16000, _writing_hook(progress))
    else:
        # ── Multi-pass: map each chunk to observations, then synthesize ──
        chunks = [frames[i:i + CHUNK] for i in range(0, len(frames), CHUNK)]
        seg_notes = []
        failed_segments = 0
        for i, ch in enumerate(chunks, 1):
            if progress:
                try:
                    progress(i, len(chunks), f"job:segment:{i}:{len(chunks)}")
                except Exception:
                    pass
            t0, t1 = ch[0][0], ch[-1][0]
            done_already = resume_notes.get(i) or resume_notes.get(str(i))
            if done_already:
                seg_notes.append(done_already)
                continue
            seg_prompt = (
                f"You are analyzing SEGMENT {i} of {len(chunks)} of game film ({_fmt_ts(t0)}–{_fmt_ts(t1)}) for a "
                f"{output_type.replace('_', ' ')}. From the frames, note the key basketball observations: what "
                f"actions/sets are run, tendencies, notable plays, and visible strengths/weaknesses for {player_name or 'the team'}. "
                "Cite specific moments by their film timestamp [MM:SS] (e.g. (12:34)), never frame numbers or raw seconds. "
                "Be concise and specific — these notes will be synthesized into one full report. Do NOT grade yet."
            )
            seg_content = [{"type": "text", "text": seg_prompt}] + _frames_content(ch)
            note = None
            last_error = None
            # A three-hour film is twenty-odd of these calls over the best part
            # of an hour, so a transient failure somewhere in the middle is
            # likely rather than exceptional. One used to cost the segment
            # outright: the minutes of film it covered were replaced by the text
            # "(analysis unavailable)" and the report was written as though that
            # stretch of the game had been watched. Retry the segment instead —
            # it is minutes of film, and re-asking costs seconds.
            for attempt in range(SEGMENT_TRIES):
                try:
                    r = _client().messages.create(model=OPUS, max_tokens=2000,
                                                  messages=[{"role": "user", "content": seg_content}])
                    note = f"SEGMENT {i} ({t0:.0f}s–{t1:.0f}s):\n{text_of(r)}"
                    break
                except Exception as exc:
                    last_error = exc
                    if _permanent(exc):
                        break        # retrying cannot help
                    if attempt + 1 < SEGMENT_TRIES:
                        time.sleep(SEGMENT_BACKOFF * (2 ** attempt))
            if note is not None:
                seg_notes.append(note)
                if on_segment:
                    # Persisted before the next call is made, so whatever kills
                    # the process cannot take this segment with it.
                    try:
                        on_segment(i, note)
                    except Exception:
                        pass
            else:
                seg_notes.append(f"SEGMENT {i}: (analysis unavailable: {last_error})")
                failed_segments += 1
                # Nothing about the next segment will go differently. Stop here
                # and say why, rather than working through the rest of the film
                # to arrive at the same answer twenty segments later.
                if _permanent(last_error):
                    raise RuntimeError(
                        f"The film could not be analyzed: {last_error}"
                    ) from last_error
        # A report synthesized from holes reads exactly like one synthesized from
        # film. If enough of the game could not be watched, the honest outcome is
        # an error the coach can retry — the job's own resume machinery will pick
        # it up and the segments that DID succeed are already saved, so trying
        # again is cheap. Handing back a confident report on a game the model
        # mostly did not see is the one outcome with no way to notice.
        if failed_segments and failed_segments >= max(1, round(len(chunks) * MAX_MISSING_FRACTION)):
            raise RuntimeError(
                f"{failed_segments} of {len(chunks)} film segments could not be analyzed, "
                f"so the report would have covered only part of the game. "
                f"Last error: {seg_notes[-1] if seg_notes else 'unknown'}"
            )
        if progress:
            try:
                progress(len(chunks), len(chunks), "job:synthesizing")
            except Exception:
                pass
        synth = bim_prompt + "\n\nOBSERVATIONS FROM ACROSS THE FULL FILM (synthesize these into the complete report):\n\n"
        if transcript_text:
            synth += f"AUDIO TRANSCRIPT:\n{transcript_text[:2000]}\n\n"
        synth += "\n\n".join(seg_notes)
        answer = _long_answer([{"role": "user", "content": synth}], 16000, _writing_hook(progress))

    header = f"BIM {output_type.upper().replace('_', ' ')} — {program} | {level}\n\n"
    return [types.TextContent(type="text", text=header + answer)]


def main() -> None:
    import asyncio

    if _MCP_ERROR is not None:
        raise SystemExit(
            f"The MCP server cannot start with the installed mcp package: {_MCP_ERROR}. "
            "Film analysis inside BloomPrint does not use it and is unaffected."
        )
    import mcp.server.stdio

    asyncio.run(mcp.server.stdio.run(app))


if __name__ == "__main__":
    main()
