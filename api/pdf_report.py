"""A report as a PDF, built on the server.

WHY THE SERVER

A browser cannot write a PDF. expo-print, which the app used, is a stub on
web — printToFileAsync returns undefined there, which is where "Cannot
destructure property 'uri'" came from, and printAsync is a bare window.print()
that prints whatever is on screen rather than the report. Every web platform
the app runs on is a browser, so Export PDF had never worked on any of them.

Rendering here means one implementation for the web, the iPad and the phone,
and a real file the coach downloads rather than a print dialog they have to
drive.

WHY IT TAKES HTML

Because that is what the app already builds. Eleven screens each compose their
own document — a season summary is a table, an evaluation is graded sections, a
training program is a week of days — and asking the server to rebuild those
from plain text would mean rewriting all eleven and hoping each still looked
right. Handed the same HTML the app would have printed, the exported file and
the printed page are the same document by construction.

WHY XHTML2PDF

Pure Python. WeasyPrint and its relatives need cairo and pango installed on the
machine, which on Railway is a build to babysit rather than a line in
requirements.txt.
"""
import io
import logging
import re

log = logging.getLogger(__name__)

MAX_HTML = 2_000_000

# Anything that would make the renderer reach off the machine, or run. The HTML
# comes from the app rather than from a stranger, but it arrives over the wire
# and is rendered by the server with the server's network — and a report is
# text either way, so nothing here is lost by refusing.
_STRIP = re.compile(
    r"<script\b[^>]*>.*?</script>|<iframe\b[^>]*>.*?</iframe>|<object\b[^>]*>.*?</object>",
    re.I | re.S,
)
_REMOTE_SRC = re.compile(r"""\s(?:src|href)\s*=\s*["']\s*(?:https?:)?//[^"']*["']""", re.I)


def _safe_html(html: str) -> str:
    return _REMOTE_SRC.sub("", _STRIP.sub("", html or ""))


def build_pdf_from_html(html: str, title: str = "Report") -> bytes:
    """Render a print document to PDF bytes. Raises if it cannot be rendered."""
    from xhtml2pdf import pisa

    src = _safe_html(html)[:MAX_HTML]
    if not src.strip():
        raise ValueError("There is nothing to export.")

    out = io.BytesIO()
    status = pisa.CreatePDF(io.StringIO(src), dest=out, encoding="utf-8")
    if status.err:
        raise ValueError(f"The document could not be laid out ({status.err} errors).")
    data = out.getvalue()
    if not data.startswith(b"%PDF"):
        raise ValueError("The renderer did not produce a PDF.")
    return data
