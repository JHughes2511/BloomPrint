"""Shared helper: turn a coach's system/philosophy profile into a prompt block
that gets injected into every report so evaluations are framed as
fit-for-this-program."""

# Ordered category key -> human label used in the prompt block.
SYSTEM_PROFILE_FIELDS = [
    ("offensive_system", "Offensive system"),
    ("defensive_system", "Defensive system"),
    ("archetypes", "Player archetypes we value"),
    ("development", "Development / training philosophy"),
    ("recruiting", "Recruiting lens"),
    ("culture", "Culture / non-negotiables"),
]


def focus_directive(text: str | None) -> str:
    """Turn a coach's focus request into a strong scoping directive so the whole
    report centers on it (a person, a group, an action, or a situation)."""
    text = (text or "").strip()
    if not text:
        return ""
    return (
        "\n\nFOCUS DIRECTIVE — center this ENTIRE report on the following and weight your "
        f"analysis heavily toward it: {text[:800]}\n"
        "If it names specific players, positions, actions, matchups, or situations, prioritize "
        "those and evaluate them in depth; only briefly touch anything outside the focus."
    )


def system_profile_block(coach) -> str:
    """Return a PROGRAM SYSTEM & PHILOSOPHY block for the prompt, or "" if the
    coach hasn't filled anything in."""
    profile = getattr(coach, "system_profile", None)
    if not isinstance(profile, dict):
        return ""
    lines = []
    for key, label in SYSTEM_PROFILE_FIELDS:
        val = (profile.get(key) or "").strip()
        if val:
            lines.append(f"- {label}: {val[:600]}")
    if not lines:
        return ""
    return (
        "\n\nPROGRAM SYSTEM & PHILOSOPHY (evaluate through this lens — frame "
        "strengths, weaknesses, and especially FIT for THIS program's system):\n"
        + "\n".join(lines)
    )
