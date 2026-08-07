"""Dropping report sections the coach switched off before sending.

The headings are the ones the app showed the coach, produced by the same two
rules the client's splitter uses: a markdown heading, or an ALL-CAPS line.
Both the training send and the eval share filter through here, so what a
player receives can never contain a section the coach withheld.
"""
import re


def _without_sections(text: str, hide: list[str]) -> str:
    """Drop the named sections from a report.

    The headings are the ones the app showed the coach, produced by the same
    two rules the client's splitter uses: a markdown heading, or an ALL-CAPS
    line. Anything not recognised as a heading stays with the section above it,
    so a section that is switched off takes its whole body with it.
    """
    wanted = {h.strip().lower() for h in hide if h and h.strip()}
    if not wanted or not text:
        return text

    def heading_of(line: str) -> str | None:
        t = line.strip()
        if re.match(r"^#{1,6}\s+", t):
            return re.sub(r"^#{1,6}\s+", "", t).replace("**", "").strip()
        if re.search(r":\s*-?\d", t):
            return None
        if len(t) < 70 and re.match(r"^[A-Z][A-Z0-9\s/&()\-:'.]{2,}$", t) and not re.search(r"[.!?]$", t):
            return t.rstrip(":").strip()
        return None

    out, dropping = [], False
    for line in text.split("\n"):
        h = heading_of(line)
        if h is not None:
            dropping = h.strip().lower() in wanted
        if not dropping:
            out.append(line)
    return "\n".join(out).strip()
