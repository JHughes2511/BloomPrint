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
