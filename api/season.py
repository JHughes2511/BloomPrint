"""Season helpers + the 'review your system & philosophy' nudge.

A basketball season is labeled by its starting year and rolls over each summer.
The nudge fires once per season when the season changes — driven both by the
calendar (checked on /auth/me, so it works even without game tracking) and by
activity (creating the first game of a new season year). Both share the coach's
last_season_reminder so it never double-fires.
"""

from datetime import datetime

SEASON_START_MONTH = 8  # a new season year begins in August


def current_season_year(now: datetime | None = None) -> str:
    now = now or datetime.utcnow()
    return str(now.year if now.month >= SEASON_START_MONTH else now.year - 1)


def maybe_season_reminder(db, coach, season_year: str | None = None) -> bool:
    """If the season has changed since we last nudged this coach, create a
    philosophy-update notification. Returns True if a new nudge was created."""
    from . import models

    season = (season_year or "").strip() or current_season_year()
    last = getattr(coach, "last_season_reminder", None)

    # First time we've seen this coach — initialize without nudging.
    if not last:
        coach.last_season_reminder = season
        return False
    if last == season:
        return False

    coach.last_season_reminder = season
    exists = (
        db.query(models.PlayerNotification)
        .filter_by(coach_id=coach.id, type="philosophy_update")
        .filter(models.PlayerNotification.body.like(f"%{season}%"))
        .first()
    )
    if not exists:
        db.add(models.PlayerNotification(
            coach_id=coach.id, type="philosophy_update",
            title="New season detected",
            body=f"A new season ({season}) has started — a good time to review and update your system & philosophy.",
        ))
    return True
