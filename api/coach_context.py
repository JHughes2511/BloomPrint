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


def resolve_level(coach=None, player=None, team=None, fallback: str = "HS Varsity") -> str:
    """The competition level an AI output should be framed at — the most specific
    non-empty source wins (player > team > coach's signup level), so every eval,
    report, scouting write-up, and training program is calibrated to the level
    the coach actually works with instead of a hardcoded default."""
    for src in (player, team, coach):
        lvl = getattr(src, "competition_level", None) if src is not None else None
        if lvl and str(lvl).strip() and str(lvl).strip().lower() != "team":
            return str(lvl).strip()
    return fallback


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
    coach hasn't filled anything in. Includes any imported philosophy reference
    material so the model keeps it in mind on every generation."""
    profile = getattr(coach, "system_profile", None)
    lines = []
    if isinstance(profile, dict):
        for key, label in SYSTEM_PROFILE_FIELDS:
            val = (profile.get(key) or "").strip()
            if val:
                lines.append(f"- {label}: {val[:600]}")

    block = ""
    if lines:
        block += (
            "\n\nPROGRAM SYSTEM & PHILOSOPHY (evaluate through this lens — frame "
            "strengths, weaknesses, and especially FIT for THIS program's system):\n"
            + "\n".join(lines)
        )

    reference = (getattr(coach, "philosophy_reference", None) or "").strip()
    if reference:
        block += (
            "\n\nCOACH-PROVIDED PHILOSOPHY REFERENCE (imported material — treat as "
            "authoritative context for how THIS program plays, develops, and "
            "recruits):\n"
            + reference[:4000]
        )

    return block
