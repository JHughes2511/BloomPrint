"""BloomPrint Video Vision MCP Server.

Exposes tools for extracting and analyzing video frames via Claude's vision API,
transcribing audio via OpenAI Whisper, and basketball-specific analysis via the
Basketball Intelligence Model (BIM).
"""

import base64
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import anthropic
import cv2
import mcp.server.stdio
import mcp.types as types
import numpy as np
from mcp.server import Server
from PIL import Image

from .bim import build_prompt, OUTPUT_TYPES, COACH_WEIGHTS, COMPETITION_LEVELS

app = Server("video-vision")

_anthropic_client: anthropic.Anthropic | None = None
_whisper_model: Any = None


def _client() -> anthropic.Anthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic()
    return _anthropic_client


def _whisper(model_name: str = "base") -> Any:
    """Lazy-load Whisper to avoid slow startup when transcription isn't used."""
    global _whisper_model
    import whisper  # type: ignore[import]

    if _whisper_model is None or _whisper_model.dims.n_mels != whisper.load_model(model_name).dims.n_mels:
        _whisper_model = whisper.load_model(model_name)
    return _whisper_model


def _frame_to_base64(frame: np.ndarray) -> str:
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        img.save(tmp.name, format="JPEG", quality=85)
        tmp_path = tmp.name
    try:
        with open(tmp_path, "rb") as f:
            return base64.standard_b64encode(f.read()).decode("utf-8")
    finally:
        os.unlink(tmp_path)


def _extract_frames(
    video_path: str,
    interval_seconds: float = 1.0,
    max_frames: int = 16,
) -> list[tuple[float, np.ndarray]]:
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

    results: list[tuple[float, np.ndarray]] = []
    for ts in timestamps:
        cap.set(cv2.CAP_PROP_POS_MSEC, ts * 1000)
        ret, frame = cap.read()
        if ret:
            results.append((ts, frame))

    cap.release()
    return results


def _extract_frames_interval(
    video_path: str,
    interval_seconds: float,
    total_cap: int,
) -> list[tuple[float, np.ndarray]]:
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
    results: list[tuple[float, np.ndarray]] = []
    t = 0.0
    while t <= duration and len(results) < total_cap:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ret, frame = cap.read()
        if ret:
            results.append((t, frame))
        t += interval_seconds
    cap.release()
    return results


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


def _transcribe(video_path: str, model_name: str) -> dict[str, Any]:
    """Extract audio from video then transcribe with Whisper. Returns Whisper result dict."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        audio_path = tmp.name
    try:
        if not _extract_audio(video_path, audio_path):
            return {"text": "", "segments": []}
        model = _whisper(model_name)
        import whisper  # type: ignore[import]
        return whisper.transcribe(model, audio_path, fp16=False)
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
                        "description": "Transcribe audio with Whisper and include it as context (default true).",
                        "default": True,
                    },
                    "whisper_model": {
                        "type": "string",
                        "description": "Whisper model size: tiny, base, small, medium, large (default base).",
                        "default": "base",
                    },
                },
                "required": ["video_path"],
            },
        ),
        types.Tool(
            name="transcribe_audio",
            description=(
                "Transcribe the audio track of a video file using OpenAI Whisper (runs locally). "
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
                        "description": "Whisper model size: tiny, base, small, medium, large (default base).",
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
                "transcribed with Whisper before being sent to Claude with the BIM prompt."
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
                        "description": "Transcribe audio with Whisper and include as context (default true).",
                        "default": True,
                    },
                    "whisper_model": {
                        "type": "string",
                        "description": "Whisper model size: tiny, base, small, medium, large (default base).",
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
        model="claude-opus-4-7",
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
    answer = response.content[0].text
    return [types.TextContent(type="text", text=f"[Frame at {ts:.2f}s]\n{answer}")]


async def _handle_transcribe_audio(args: dict[str, Any]) -> list[types.TextContent]:
    video_path = args["video_path"]
    model_name = args.get("model", "base")
    language = args.get("language")

    if not Path(video_path).exists():
        return [types.TextContent(type="text", text=f"Error: file not found: {video_path}")]

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        audio_path = tmp.name
    try:
        if not _extract_audio(video_path, audio_path):
            return [types.TextContent(type="text", text="Error: no audio track found or ffmpeg unavailable.")]

        model = _whisper(model_name)
        import whisper  # type: ignore[import]

        kwargs: dict[str, Any] = {"fp16": False}
        if language:
            kwargs["language"] = language
        result = whisper.transcribe(model, audio_path, **kwargs)
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
    whisper_model = args.get("whisper_model", "base")

    if not Path(video_path).exists():
        return [types.TextContent(type="text", text=f"Error: file not found: {video_path}")]

    frames = _extract_frames(video_path, interval, max_frames)
    if not frames:
        return [types.TextContent(type="text", text="Error: no frames could be extracted.")]

    transcript_text = ""
    if include_audio:
        try:
            result = _transcribe(video_path, whisper_model)
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
        model="claude-opus-4-7",
        max_tokens=8192,
        messages=[{"role": "user", "content": content}],
    )
    answer = response.content[0].text

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
    whisper_model = args.get("whisper_model", "base")

    if not video_paths:
        return [types.TextContent(type="text", text=f"Error: file not found: {video_path}")]

    try:
        bim_prompt = build_prompt(output_type, program, level, coach_weight, player_name)
    except ValueError as e:
        return [types.TextContent(type="text", text=f"Error: {e}")]

    if focus_prompt:
        bim_prompt += f"\n\nADDITIONAL FOCUS:\n{focus_prompt}"

    # Interval sampling: one frame every `interval` seconds across the WHOLE film
    # so a 6-min and a 60-min clip get the same per-minute coverage. For long
    # films we analyze in chunks (map) and synthesize one report (reduce).
    CHUNK = 40
    TOTAL_CAP = 400
    progress = args.get("_progress")   # optional callable(done, total, label)
    # Sample frames from every film, sharing the total-frame budget across them.
    per_cap = max(20, TOTAL_CAP // max(len(video_paths), 1))
    frames = []
    for p in video_paths:
        frames += _extract_frames_interval(p, interval, per_cap)
    frames = frames[:TOTAL_CAP]
    if not frames:
        return [types.TextContent(type="text", text="Error: no frames could be extracted.")]

    transcript_text = ""
    # Audio transcription only for a single film (keeps multi-film fast).
    if include_audio and len(video_paths) == 1:
        try:
            result = _transcribe(video_path, whisper_model)
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
        response = _client().messages.create(
            model="claude-opus-4-7", max_tokens=4096,
            messages=[{"role": "user", "content": content}],
        )
        answer = response.content[0].text
    else:
        # ── Multi-pass: map each chunk to observations, then synthesize ──
        chunks = [frames[i:i + CHUNK] for i in range(0, len(frames), CHUNK)]
        seg_notes = []
        for i, ch in enumerate(chunks, 1):
            if progress:
                try:
                    progress(i, len(chunks), f"Analyzing segment {i} of {len(chunks)}")
                except Exception:
                    pass
            t0, t1 = ch[0][0], ch[-1][0]
            seg_prompt = (
                f"You are analyzing SEGMENT {i} of {len(chunks)} of game film ({_fmt_ts(t0)}–{_fmt_ts(t1)}) for a "
                f"{output_type.replace('_', ' ')}. From the frames, note the key basketball observations: what "
                f"actions/sets are run, tendencies, notable plays, and visible strengths/weaknesses for {player_name or 'the team'}. "
                "Cite specific moments by their film timestamp [MM:SS] (e.g. (12:34)), never frame numbers or raw seconds. "
                "Be concise and specific — these notes will be synthesized into one full report. Do NOT grade yet."
            )
            seg_content = [{"type": "text", "text": seg_prompt}] + _frames_content(ch)
            try:
                r = _client().messages.create(model="claude-opus-4-7", max_tokens=1200,
                                              messages=[{"role": "user", "content": seg_content}])
                seg_notes.append(f"SEGMENT {i} ({t0:.0f}s–{t1:.0f}s):\n{r.content[0].text}")
            except Exception as exc:
                seg_notes.append(f"SEGMENT {i}: (analysis unavailable: {exc})")
        if progress:
            try:
                progress(len(chunks), len(chunks), "Synthesizing report")
            except Exception:
                pass
        synth = bim_prompt + "\n\nOBSERVATIONS FROM ACROSS THE FULL FILM (synthesize these into the complete report):\n\n"
        if transcript_text:
            synth += f"AUDIO TRANSCRIPT:\n{transcript_text[:2000]}\n\n"
        synth += "\n\n".join(seg_notes)
        response = _client().messages.create(model="claude-opus-4-7", max_tokens=4096,
                                             messages=[{"role": "user", "content": synth}])
        answer = response.content[0].text

    header = f"BIM {output_type.upper().replace('_', ' ')} — {program} | {level}\n\n"
    return [types.TextContent(type="text", text=header + answer)]


def main() -> None:
    import asyncio

    asyncio.run(mcp.server.stdio.run(app))


if __name__ == "__main__":
    main()
