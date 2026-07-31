"""A cap on how fast one caller can retry.

Only the endpoints where guessing pays: login and registration. Without it,
password strength is the only thing between an attacker and an account, and
they get unlimited attempts per second to test it. With it, an online guessing
attack becomes impractical regardless of how weak the password is.

In-process and in-memory, deliberately. A shared store would be correct across
several workers, and this app runs as one; adding Redis to protect a
single-process server is complexity that buys nothing today. If this ever runs
multi-worker, each worker enforces its own share of the limit — weaker than
intended but never weaker than having none, which is what it replaces.
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

# Generous next to a person typing a password they know, restrictive next to a
# script working through a wordlist.
LOGIN_ATTEMPTS = 10
LOGIN_WINDOW_SECONDS = 60

_hits: dict[str, deque] = defaultdict(deque)


def _client_key(request: Request, bucket: str) -> str:
    # X-Forwarded-For only when a proxy sets it; taking it unconditionally would
    # let any caller pick their own bucket by sending the header themselves.
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else (
        request.client.host if request.client else "unknown")
    return f"{bucket}:{ip}"


def check(request: Request, bucket: str = "login",
          limit: int = LOGIN_ATTEMPTS, window: int = LOGIN_WINDOW_SECONDS) -> None:
    """Raise 429 if this caller has exceeded `limit` attempts within `window`."""
    key = _client_key(request, bucket)
    now = time.monotonic()
    hits = _hits[key]
    while hits and now - hits[0] > window:
        hits.popleft()
    if len(hits) >= limit:
        retry_after = int(window - (now - hits[0])) + 1
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Wait a minute and try again.",
            headers={"Retry-After": str(retry_after)},
        )
    hits.append(now)

    # Buckets for callers who stopped are dead weight; clear them out when the
    # map grows, so a stream of distinct IPs can't turn this into a memory leak.
    if len(_hits) > 10_000:
        for k in [k for k, v in _hits.items() if not v or now - v[-1] > window]:
            del _hits[k]


def reset() -> None:
    """Clear all counters. For tests."""
    _hits.clear()
