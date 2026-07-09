"""Season helpers + the 'review your system & philosophy' nudge.

The nudge fires at most once per season, when either:
  • the coach's competition-level season rolls over (calendar-driven, checked on
    /auth/me so it works even without game tracking), or
  • the coach returns to the app after a long dormant gap (a likely new cycle).

It never fires for a brand-new account in its first season, and is deduped so
the calendar and game-activity triggers don't double-nudge. `last_active` is
updated on app-open / login / game creation so dormancy reflects real usage
(logins, and the reports/messages that happen inside an open session).
"""

from datetime import datetime

# Month a new season year begins, per competition level. A season that spans
# the new year is labeled by its STARTING year.
SEASON_START_BY_LEVEL = {
    "HS Varsity": 11,
    "HS JV": 11,
    "Middle School": 11,
    "College": 11,
    "Pro": 10,
    "AAU": 4,
    "Youth": 9,
}
DEFAULT_START_MONTH = 11
DORMANT_DAYS = 90


def _start_month(competition_level: str | None) -> int:
    return SEASON_START_BY_LEVEL.get((competition_level or "").strip(), DEFAULT_START_MONTH)


def current_season_year(now: datetime | None = None, competition_level: str | None = None) -> str:
    now = now or datetime.utcnow()
    start = _start_month(competition_level)
    return str(now.year if now.month >= start else now.year - 1)


def maybe_season_reminder(db, coach, game_year: str | None = None, now: datetime | None = None) -> bool:
    """Create a philosophy-update nudge if the season changed OR the coach is
    returning after a long dormant gap. Reads coach.last_active as the PREVIOUS
    activity time (the caller updates it afterward). Returns True if nudged."""
    from . import models

    now = now or datetime.utcnow()
    season = (game_year or "").strip() or current_season_year(now, getattr(coach, "competition_level", None))
    last = getattr(coach, "last_season_reminder", None)

    # First time we've evaluated this coach — initialize without nudging.
    if not last:
        coach.last_season_reminder = season
        return False

    prev_active = getattr(coach, "last_active", None)
    dormant_return = bool(prev_active and (now - prev_active).days >= DORMANT_DAYS)
    season_changed = last != season
    if not (season_changed or dormant_return):
        return False

    coach.last_season_reminder = season
    exists = (
        db.query(models.PlayerNotification)
        .filter_by(coach_id=coach.id, type="philosophy_update")
        .filter(models.PlayerNotification.body.like(f"%{season}%"))
        .first()
    )
    if not exists:
        reason = (f"A new season ({season}) has started"
                  if season_changed else "Welcome back")
        db.add(models.PlayerNotification(
            coach_id=coach.id, type="philosophy_update",
            title="Review your system & philosophy",
            body=f"{reason} — a good time to review and update your system & philosophy for {season}.",
        ))
    return True


def touch_and_maybe_remind(db, coach, game_year: str | None = None) -> bool:
    """Run the nudge check against the PREVIOUS activity time, then stamp
    last_active = now. Returns True if a nudge was created."""
    now = datetime.utcnow()
    created = maybe_season_reminder(db, coach, game_year=game_year, now=now)
    coach.last_active = now
    return created
