"""Canonical report-formatting directive.

Every AI-generated report in BloomPrint (player evals, team reports, scouting,
game reports, packets, clip analysis, training programs, summaries) is rendered
by the SAME two renderers — the in-app renderer (renderReport.tsx) and the
PDF/print renderer (mdToHtml.ts). Both understand exactly one house style:

  - ALL-CAPS section titles on their own line, ending with a colon → drawn as
    an underlined heading.
  - Findings as bullet lines starting with "- " → drawn as real bullets.
  - A blank line between bullets/sections → clean vertical spacing.
  - Markdown pipe tables → drawn as real tables (box scores, grade breakdowns).

To keep every report type looking identical and easy to scan, append
REPORT_FORMAT (or REPORT_FORMAT_WITH_TABLES) to the prompt of anything that
generates report prose. Do NOT hand-roll per-endpoint formatting rules — reuse
this so the house style stays in one place.
"""

REPORT_FORMAT = (
    "\n\nFORMATTING (a coach must be able to scan this in seconds — follow exactly):\n"
    "- Do NOT use any markdown: no ## headers, no ** bold, no backticks, and no "
    "--- / === / ——— divider lines.\n"
    "- Write each section title in ALL CAPS on its own line followed by a colon, "
    "then a blank line before its content. Example:\n\nKEY TAKEAWAYS:\n\n- First point\n\n- Second point\n"
    "- Present findings as bullet points that each start with '- ' (a hyphen and a "
    "space), one idea per bullet, with a blank line between bullets so they don't "
    "run together.\n"
    "- Favor tight, scannable bullets over long paragraphs.\n"
    "- Do NOT write 'END OF REPORT' or any closing marker."
)

# Same house style, but explicitly permits markdown pipe tables for numeric
# breakdowns (box scores, pillar grades). Both renderers draw these as real
# tables, so use this variant wherever tabular stats belong.
REPORT_FORMAT_WITH_TABLES = REPORT_FORMAT + (
    "\n- For numeric breakdowns (box scores, per-player grades), you MAY use a "
    "markdown pipe table with a header row and a |---| separator row; it will be "
    "rendered as a real table."
)
