"""Report sections: dropping the ones a coach switched off, and correcting one.

Two jobs over the same idea — a report is a series of headed sections, and
both of them need to act on one section without disturbing the others.

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


# ── Correcting one section ────────────────────────────────────────────────────
#
# A coach's correction is about one part of a report. Re-watching the film to
# verify it is right — that is how the model finds out whether the coach is
# describing something that actually happened — but rewriting the whole
# document afterwards is not: everything the coach did NOT question comes back
# reworded, and they have to re-read a report they had already accepted to find
# out what changed.
#
# So the model is asked to correct one section, and what follows is what makes
# that a guarantee rather than a request.

# A heading is a short line in capitals, usually ending in a colon:
#
#   EXECUTIVE SUMMARY:
#   OFFENSIVE TENDENCIES — ANGOLA:
#
# Digits, spaces and the handful of punctuation marks the reports use are
# allowed; a lowercase letter is not, which is what keeps a shouted sentence in
# the body from being mistaken for a heading.
_HEADING = re.compile(r"^(?P<h>[A-Z0-9][A-Z0-9 &/#'’,.\-—–()%]{2,79}:?)\s*$")


def _is_heading(line: str) -> bool:
    line = line.strip()
    if not line or len(line) > 80:
        return False
    # A sentence in capitals is still a sentence. Reports shout for emphasis —
    # "HE MUST STAY HOME ON THE SHOOTER" sitting in a paragraph is not a new
    # section, and treating it as one splits a body in half and then protects
    # the wrong halves of it from a correction.
    if line.endswith((".", ",", ";", "!", "?")):
        return False
    if len(line.split()) > 10:
        return False
    if not _HEADING.match(line):
        return False
    # At least three letters, so "1." or "—" is not a section.
    return sum(1 for ch in line if ch.isalpha()) >= 3


def split_sections(text: str) -> list[tuple[str, str]]:
    """[(heading, body_including_heading), ...].

    Anything before the first heading is returned under the empty heading, so
    joining the parts back together reproduces the input exactly.
    """
    if not text:
        return []
    lines = text.splitlines(keepends=True)
    out: list[tuple[str, list[str]]] = [("", [])]
    for line in lines:
        if _is_heading(line):
            out.append((line.strip().rstrip(":").strip(), [line]))
        else:
            out[-1][1].append(line)
    return [(h, "".join(body)) for h, body in out if h or "".join(body).strip()]


def join_sections(sections: list[tuple[str, str]]) -> str:
    return "".join(body for _h, body in sections)


def _norm(heading: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (heading or "").lower())


def apply_section_correction(original: str, corrected: str, changed: str | None = None) -> str:
    """The original, with only the corrected section replaced.

    `corrected` is the model's rewrite of the whole document. Any section it
    changed that it was not asked to change is discarded — the original wins.
    `changed` names the section the correction was about; when it is None or
    matches nothing, the sections that actually differ are used instead, which
    still holds the guarantee for everything else.

    A section the correction ADDS is kept, in the position the rewrite put it:
    a coach pointing at something the report never mentioned is asking for it
    to be mentioned.
    """
    if not original.strip():
        return corrected
    if not corrected.strip():
        return original

    old = split_sections(original)
    new = split_sections(corrected)
    old_by = {_norm(h): body for h, body in old if h}
    target = _norm(changed) if changed else ""

    out: list[tuple[str, str]] = []
    for heading, body in new:
        key = _norm(heading)
        prior = old_by.get(key)
        if prior is None:
            out.append((heading, body))          # new section — keep it
        elif target and key == target:
            out.append((heading, body))          # the one being corrected
        elif not target:
            out.append((heading, body))          # no target named: take the diff as-is
        else:
            out.append((heading, prior))         # untouched by this correction
    # A section the rewrite dropped altogether is put back: a correction about
    # one thing is not permission to delete another.
    kept = {_norm(h) for h, _b in out}
    for i, (heading, body) in enumerate(old):
        if heading and _norm(heading) not in kept:
            out.insert(min(i, len(out)), (heading, body))
    return join_sections(out)
