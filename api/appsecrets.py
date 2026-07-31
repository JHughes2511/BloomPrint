"""The signing keys behind every token, and where they come from.

Named appsecrets rather than secrets so it can't be confused with — or shadow —
the standard library module it uses.

WHAT WAS WRONG

The coach key defaulted to the literal "change-me-in-production" and the player
key was a hardcoded string with no override at all. Both are in the repository's
history, so anyone who could read the source could mint a token for any coach or
any player and the server would accept it. No password needed, no login attempt
recorded. That is not "weak crypto", it is an authentication bypass, and it does
not become one when the app is deployed — it already is one for anyone who can
reach the API.

WHERE KEYS COME FROM NOW

BLOOMPRINT_SECRET if set. Otherwise a random 48-byte secret generated on first
run and stored, owner-readable only, next to the database. That fallback exists
so a laptop keeps working with no setup — the alternative is a default value,
and any default that works is a default that ships. It is a real secret, unique
per machine, and never in the repository.

Known-bad values are rejected outright rather than warned about. A warning in a
log is not a control; someone who copied the old value into their environment
should get a server that refuses to start, not one that starts insecurely.

TWO KEYS, NOT ONE

Coach and player tokens are signed with separate keys derived from the root, so
a token minted for one audience can never validate as the other. The sub claims
differ today ("12" vs "player:12"), which makes confusion unlikely, but that is
a parsing convention — a key boundary is a guarantee.
"""
import hashlib
import hmac
import logging
import os
import secrets as stdlib_secrets
import stat
from functools import lru_cache
from pathlib import Path

log = logging.getLogger(__name__)

# Values that shipped in the source. Anything matching is refused, so a copied
# .env can't quietly reinstate the bypass.
KNOWN_WEAK = {
    "change-me-in-production",
    "bloomprint-player-secret-change-in-prod",
    "changeme",
    "secret",
}

SECRET_FILE_ENV = "BLOOMPRINT_SECRET_FILE"
DEFAULT_SECRET_FILE = ".bloomprint-secret"


class InsecureSecret(RuntimeError):
    """The configured secret is one of the known published values."""


def _secret_path() -> Path:
    configured = os.environ.get(SECRET_FILE_ENV)
    if configured:
        return Path(configured)
    # Alongside the database, which is already the per-machine state directory.
    db = os.environ.get("BLOOMPRINT_DB", "bloomprint.db")
    return Path(db).expanduser().resolve().parent / DEFAULT_SECRET_FILE


def _read_or_create() -> str:
    path = _secret_path()
    try:
        existing = path.read_text().strip()
        if existing:
            return existing
    except FileNotFoundError:
        pass
    except OSError as exc:
        raise RuntimeError(f"Could not read {path}: {exc}") from exc

    value = stdlib_secrets.token_urlsafe(48)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Create with 0600 from the start. Writing then chmod-ing leaves a
        # window where the key is world-readable.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IRUSR | stat.S_IWUSR)
        try:
            os.write(fd, value.encode())
        finally:
            os.close(fd)
    except FileExistsError:
        # Another worker created it between our read and our write.
        return path.read_text().strip()
    except OSError as exc:
        raise RuntimeError(
            f"No BLOOMPRINT_SECRET is set and {path} could not be created ({exc}). "
            "Set BLOOMPRINT_SECRET in the environment."
        ) from exc

    log.warning(
        "No BLOOMPRINT_SECRET set — generated one at %s. Fine for local use. "
        "Set BLOOMPRINT_SECRET in the environment before deploying, or every "
        "restart on fresh storage signs everyone out.",
        path,
    )
    return value


@lru_cache(maxsize=1)
def root_secret() -> str:
    """The master secret. Everything else is derived from it.

    Cached: this is on the path of every authenticated request, and without it
    each one would re-read the key file.
    """
    configured = (os.environ.get("BLOOMPRINT_SECRET") or "").strip()
    if configured:
        if configured in KNOWN_WEAK:
            raise InsecureSecret(
                "BLOOMPRINT_SECRET is set to a value published in this repository. "
                "Anyone can forge tokens with it. Generate a new one:\n"
                "    python3 -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        if len(configured) < 16:
            raise InsecureSecret(
                f"BLOOMPRINT_SECRET is only {len(configured)} characters. Use at "
                "least 16; 32+ is better."
            )
        return configured
    return _read_or_create()


@lru_cache(maxsize=8)
def derive(purpose: str) -> str:
    """A separate key per audience, from the one root secret.

    Keyed derivation rather than root + a suffix: knowing one derived key must
    not reveal the root or let anyone compute the other.
    """
    return hmac.new(
        root_secret().encode(), f"bloomprint/{purpose}".encode(), hashlib.sha256
    ).hexdigest()


def coach_key() -> str:
    return derive("coach-token")


def player_key() -> str:
    return derive("player-token")
