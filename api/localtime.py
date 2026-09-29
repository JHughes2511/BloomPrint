"""Dates written by the server, on the day the reader is having.

A game's date is stored as an instant in UTC, which is right: it is one moment,
wherever anyone is. But printing it means choosing a calendar, and the server
was choosing UTC's. A game tipping off at 8:30pm in Chicago is 1:30am the next
day in UTC, so the app showed August 8 and every piece of text the server wrote
about the same game said August 9: the Game Insights text a staff member is
sent, the box score, a player's game history, the Ask BloomPrint game list, the
dates the AI is given when it writes a report.

The app now says which time zone its reader is in, as an X-Timezone header on
every request (an IANA name such as America/Chicago). The middleware below puts
it where these formatters can reach it without every route passing it down, and
local_day() prints a stored instant on that reader's calendar. Text built when
it is read, which is how a shared game's Game Insights reach their recipient,
is therefore dated for whoever is reading it.

No header, an unknown zone, or code running outside any request: UTC, which is
what everything did before. Nothing gets a date it did not have.
"""
from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

HEADER = b"x-timezone"

_reader_zone: ContextVar[ZoneInfo | None] = ContextVar("reader_zone", default=None)


def _zone(name: str | None) -> ZoneInfo | None:
    """A time zone from an IANA name, or None if it is not one."""
    name = (name or "").strip()
    # A name, not a path: ZoneInfo reads files, and "../" has no business here.
    if not name or len(name) > 64 or ".." in name or name.startswith("/"):
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return None


def reader_zone() -> ZoneInfo | None:
    """The time zone of whoever this request is for, if they said."""
    return _reader_zone.get()


def to_local(dt: datetime | None) -> datetime | None:
    """A stored instant on the reader's clock. Naive values are taken as UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    zone = reader_zone()
    return dt.astimezone(zone) if zone else dt.astimezone(timezone.utc)


def local_day(dt: datetime | None, fmt: str) -> str:
    """strftime, on the reader's calendar. Empty for no date."""
    local = to_local(dt)
    return local.strftime(fmt) if local else ""


class ReaderTimezoneMiddleware:
    """Take the reader's time zone off the request, for the formatters above.

    Plain ASGI rather than BaseHTTPMiddleware on purpose: this sets a context
    variable, and it has to be visible to the route, to its dependencies, and
    to the background tasks the route schedules. Setting it here, before the
    rest of the app is called, puts it in the context all of those copy.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        raw = dict(scope.get("headers") or []).get(HEADER)
        token = _reader_zone.set(_zone(raw.decode("latin-1") if raw else None))
        try:
            await self.app(scope, receive, send)
        finally:
            _reader_zone.reset(token)
