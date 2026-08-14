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
import os
import re

log = logging.getLogger(__name__)

FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")

# ── Fonts ────────────────────────────────────────────────────────────────────
#
# A PDF only shows a character if the font it is drawn in has that glyph, and
# the renderer's default — Helvetica — has Latin and nothing else. So a coach
# writing in Russian, Greek, Hebrew, Arabic, Georgian, Hindi or any CJK
# language exported a page of black boxes. The app offers 25 languages and
# writes its reports in the coach's own, so this was most of them.
#
# No single font covers all 25, which is why there are two here and a third
# route for CJK. Measured rather than assumed:
#   BPSans (DejaVu)      — Latin, Greek, Cyrillic, Hebrew, ARABIC, Georgian
#   BPSansIndic (Free)   — the same minus Arabic, plus DEVANAGARI
#   CJK                  — ReportLab's built-in CID fonts, no file needed
# Both files are subset to those scripts, which takes them from 3.2MB to under
# 1MB without dropping a glyph any of the 25 languages can reach.
_DEFAULT = "BPSans"
_INDIC = "BPSansIndic"
_CJK = {
    "zh": "STSong-Light",
    "ja": "HeiseiKakuGo-W5",
    "ko": "HYSMyeongJo-Medium",
}

def _face_rules(name: str) -> str:
    """@font-face for a bundled family, or "" if the files are not there.

    Declared in the document's CSS rather than registered with ReportLab.
    xhtml2pdf resolves a CSS font-family through its own table of known names,
    so a face registered only with ReportLab is not one it can find — the
    family silently falls back to Helvetica and the glyphs go back to being
    boxes. @font-face is the name it does look up.
    """
    regular = os.path.join(FONT_DIR, f"{name}.ttf")
    bold = os.path.join(FONT_DIR, f"{name}-Bold.ttf")
    if not (os.path.exists(regular) and os.path.exists(bold)):
        log.warning("PDF font %s is missing from %s — falling back to the "
                    "renderer's default, which covers Latin only", name, FONT_DIR)
        return ""
    return (f'@font-face {{ font-family: "{name}"; src: url("{regular}"); }}'
            f'@font-face {{ font-family: "{name}"; src: url("{bold}"); font-weight: bold; }}')


_HAS_CJK = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]")
_HAS_HANGUL = re.compile(r"[\uac00-\ud7af]")
_HAS_KANA = re.compile(r"[\u3040-\u30ff]")
_HAS_DEVANAGARI = re.compile(r"[\u0900-\u097f]")


def _font_for(text: str) -> str:
    """The font that can actually draw this report.

    One font per document rather than per run: ReportLab does not fall back
    glyph by glyph, so the choice is made from what the report is mostly
    written in. The CJK faces carry Latin and digits too, so a Japanese report
    quoting a team name in Latin still reads.
    """
    if _HAS_HANGUL.search(text):
        return _CJK["ko"]
    if _HAS_KANA.search(text):
        return _CJK["ja"]
    if _HAS_CJK.search(text):
        return _CJK["zh"]
    if _HAS_DEVANAGARI.search(text):
        return _INDIC
    return _DEFAULT

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


# ── Right-to-left ────────────────────────────────────────────────────────────
#
# The renderer lays glyphs out left to right and joins nothing, so Hebrew came
# out backwards and Arabic came out backwards AND with every letter in its
# isolated form — legible to nobody. Neither is something a font fixes.
#
# So the text is shaped and reordered here before it is laid out: Arabic
# letters are put into the contextual forms that join them up, and both scripts
# are put into visual order. Measured against the renderer rather than assumed
# — it does not do either, so doing it here cannot double up.
_RTL_CHARS = re.compile(r"[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\ufb1d-\ufdff\ufe70-\ufeff]")
_ARABIC_CHARS = re.compile(r"[\u0600-\u06ff\u0750-\u077f]")
# Text nodes only: a tag, and the contents of style, are not prose.
_TAG_OR_STYLE = re.compile(r"(<style\b[^>]*>.*?</style>|<[^>]+>)", re.I | re.S)


def _shape_rtl(html: str) -> str:
    """Put Hebrew and Arabic into the order and the letterforms they read in."""
    if not _RTL_CHARS.search(html):
        return html
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display
    except Exception:
        log.warning("RTL shaping libraries are unavailable; Hebrew and Arabic "
                    "will export in the wrong order")
        return html

    def fix(text: str) -> str:
        if not _RTL_CHARS.search(text):
            return text
        try:
            shaped = arabic_reshaper.reshape(text) if _ARABIC_CHARS.search(text) else text
            return get_display(shaped)
        except Exception:
            return text

    return "".join(part if _TAG_OR_STYLE.fullmatch(part) else fix(part)
                   for part in _TAG_OR_STYLE.split(html))


def _with_font(html: str, font: str) -> str:
    """Put the chosen font on everything, after whatever the document says.

    Appended to the end of <head> so it wins over the page's own font-family
    without having to rewrite it, and applied to the table and list elements
    too — a heading in the right font above a table in Helvetica is the same
    bug, just smaller.
    """
    faces = "" if font in _CJK.values() else _face_rules(font)
    if not faces and font not in _CJK.values():
        return html          # nothing to point at; leave the document alone
    rule = (f"<style>{faces}"
            f"body,div,p,span,td,th,li,h1,h2,h3,h4,h5,h6,table,ul,ol"
            f'{{font-family:"{font}";}}</style>')
    if "</head>" in html:
        return html.replace("</head>", rule + "</head>", 1)
    return rule + html


def build_pdf_from_html(html: str, title: str = "Report") -> bytes:
    """Render a print document to PDF bytes. Raises if it cannot be rendered."""
    from xhtml2pdf import pisa

    src = _safe_html(html)[:MAX_HTML]
    if not src.strip():
        raise ValueError("There is nothing to export.")

    # Shaped before the font is chosen: reshaping turns Arabic base letters
    # into presentation forms, and the font has to be one that has those.
    src = _shape_rtl(src)
    src = _with_font(src, _font_for(src))

    out = io.BytesIO()
    status = pisa.CreatePDF(io.StringIO(src), dest=out, encoding="utf-8")
    if status.err:
        raise ValueError(f"The document could not be laid out ({status.err} errors).")
    data = out.getvalue()
    if not data.startswith(b"%PDF"):
        raise ValueError("The renderer did not produce a PDF.")
    return data
