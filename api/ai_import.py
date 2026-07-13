"""Shared AI-powered import: turn ANY uploaded file (Excel, CSV, PDF, Word,
image/photo, plain text) into either clean text or structured rows, so every
"Import" button in the app behaves the same — accept anything, let the model
read it, and return a preview the coach confirms before committing.

The heavy lifting is one call to Claude with the file as native content blocks
(images/PDFs as vision/document blocks; spreadsheets/docs as extracted text).
"""
from __future__ import annotations

import base64
import io
import json
import re
from typing import Any


def file_to_content_blocks(data: bytes, filename: str, content_type: str | None) -> tuple[list[dict], bool]:
    """Turn raw upload bytes into Claude content blocks. Returns (blocks, is_text)
    where is_text is True when the content is plain extracted text (no vision/PDF
    block needed). Best-effort — never raises."""
    name = (filename or "").lower()
    ctype = (content_type or "").lower()

    # Images → vision block
    if ctype.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif")):
        media = ("image/png" if name.endswith(".png") else
                 "image/webp" if name.endswith(".webp") else
                 "image/gif" if name.endswith(".gif") else "image/jpeg")
        return [{"type": "image", "source": {"type": "base64", "media_type": media, "data": base64.b64encode(data).decode()}}], False

    # PDF → native document block
    if ctype == "application/pdf" or name.endswith(".pdf"):
        return [{"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(data).decode()}}], False

    # Excel → text grid
    if name.endswith((".xlsx", ".xls")) or "spreadsheet" in ctype or "excel" in ctype:
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            lines = []
            for ws in wb.worksheets:
                lines.append(f"# Sheet: {ws.title}")
                for row in ws.iter_rows(values_only=True):
                    cells = [str(c) for c in row if c is not None]
                    if cells:
                        lines.append(" | ".join(cells))
            return [{"type": "text", "text": "\n".join(lines)[:20000]}], True
        except Exception:
            pass

    # Word
    if name.endswith(".docx") or "word" in ctype:
        try:
            import docx
            d = docx.Document(io.BytesIO(data))
            return [{"type": "text", "text": "\n".join(p.text for p in d.paragraphs if p.text.strip())[:20000]}], True
        except Exception:
            pass

    # Plain text / CSV / anything decodable
    try:
        return [{"type": "text", "text": data.decode("utf-8", errors="ignore")[:20000]}], True
    except Exception:
        return [], True


def _client():
    import anthropic
    return anthropic.Anthropic()


def _extract_json(text: str) -> Any:
    """Pull the first JSON object/array out of a model response."""
    text = text.strip()
    # Strip code fences
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            return None
    return None


def ai_extract_json(data: bytes, filename: str, content_type: str | None, instruction: str) -> Any:
    """Feed the file to Claude with `instruction` (which must ask for JSON only)
    and return the parsed JSON, or None."""
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is not configured on the server.")
    blocks, _ = file_to_content_blocks(data, filename, content_type)
    if not blocks:
        return None
    content = [{"type": "text", "text": instruction}] + blocks
    resp = _client().messages.create(
        model="claude-opus-4-7", max_tokens=8000,
        messages=[{"role": "user", "content": content}],
    )
    return _extract_json(resp.content[0].text)


def ai_extract_text(data: bytes, filename: str, content_type: str | None, purpose: str) -> str:
    """Return clean text from the file. If it's already text-extractable we return
    it directly; images/PDFs are transcribed by the model, focused on `purpose`."""
    blocks, is_text = file_to_content_blocks(data, filename, content_type)
    if not blocks:
        return ""
    if is_text:
        # Already have the text — return it as-is (fast, no AI needed).
        return blocks[0].get("text", "").strip()
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is not configured on the server.")
    instruction = (
        f"Read the attached file and extract its text content for use as {purpose}. "
        "Transcribe the meaningful content faithfully and cleanly (no commentary, no "
        "markdown fences). If it is a handwritten or photographed note, transcribe what "
        "it says. Return ONLY the extracted text."
    )
    content = [{"type": "text", "text": instruction}] + blocks
    resp = _client().messages.create(
        model="claude-opus-4-7", max_tokens=6000,
        messages=[{"role": "user", "content": content}],
    )
    return resp.content[0].text.strip()


# ── Context-specific structured extractors ────────────────────────────────────

ROSTER_INSTRUCTION = (
    "You are extracting a basketball ROSTER from the attached file (it may be a "
    "spreadsheet, PDF, Word doc, photo of a roster, or text). Return ONLY a JSON "
    "object of this exact shape:\n"
    '{"players": [{"name": "", "jersey_number": "", "position": "", "height": "", '
    '"wingspan": "", "weight": "", "school_name": "", "competition_level": ""}]}\n'
    "Rules: one entry per player. name is required — skip rows without a name. Use "
    "empty string for any field not present. jersey_number as a string (e.g. \"23\"). "
    "height like 6'2\". Do not invent players or data. Return JSON only, no prose."
)

GAME_STATS_INSTRUCTION = (
    "You are extracting a basketball BOX SCORE / stat sheet from the attached file "
    "(spreadsheet, PDF, photo, or text). Return ONLY a JSON object of this shape:\n"
    '{"players": [{"player_name": "", "is_opponent": false, '
    '"stats": {"2 FG Made": 0, "3 FG Made": 0, "FT Made": 0, "Off. Reb": 0, '
    '"Def. Reb": 0, "Assists": 0, "Steal": 0, "Blocked Shot": 0, "Turnover": 0, '
    '"Foul Against": 0}}]}\n'
    "Rules: one entry per player. Map the file's columns to these stat names (e.g. "
    "PTS/REB/AST/STL/BLK/TO/PF, made field goals, threes, free throws). If only "
    "totals like points and rebounds are given, infer made-shot counts only when "
    "the file states them explicitly — otherwise leave those stats at 0. Set "
    "is_opponent true for players clearly on the opposing team. Omit any stat you "
    "can't determine (leave at 0). Return JSON only, no prose."
)
