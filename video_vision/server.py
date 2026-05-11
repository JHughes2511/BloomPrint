"""BloomPrint Video Vision MCP Server.

Exposes tools for extracting and analyzing video frames via Claude's vision API.
"""

import base64
import os
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

app = Server("video-vision")

_anthropic_client: anthropic.Anthropic | None = None


def _client() -> anthropic.Anthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic()
    return _anthropic_client


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
    timestamps = []
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
                "Analyze an entire video by sampling frames at regular intervals and asking "
                "Claude a question about the combined visual content."
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
                },
                "required": ["video_path"],
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
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": img_b64,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )
    answer = response.content[0].text
    return [types.TextContent(type="text", text=f"[Frame at {ts:.2f}s]\n{answer}")]


async def _handle_analyze_video(args: dict[str, Any]) -> list[types.TextContent]:
    video_path = args["video_path"]
    prompt = args.get("prompt", "Describe what happens in this video.")
    interval = float(args.get("interval_seconds", 2.0))
    max_frames = min(int(args.get("max_frames", 8)), 20)

    if not Path(video_path).exists():
        return [types.TextContent(type="text", text=f"Error: file not found: {video_path}")]

    frames = _extract_frames(video_path, interval, max_frames)
    if not frames:
        return [types.TextContent(type="text", text="Error: no frames could be extracted.")]

    content: list[dict] = []
    for ts, frame in frames:
        content.append({"type": "text", "text": f"[Frame at {ts:.2f}s]"})
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": _frame_to_base64(frame),
                },
            }
        )
    content.append({"type": "text", "text": prompt})

    response = _client().messages.create(
        model="claude-opus-4-7",
        max_tokens=2048,
        messages=[{"role": "user", "content": content}],
    )
    answer = response.content[0].text
    header = f"Video analysis ({len(frames)} frames sampled): {video_path}\n{'─' * 60}\n"
    return [types.TextContent(type="text", text=header + answer)]


def main() -> None:
    import asyncio

    asyncio.run(mcp.server.stdio.run(app))


if __name__ == "__main__":
    main()
