"""Google Sign-In helper.

Verifies a Google ID token and returns the identity (email, name, sub). Gated
on the GOOGLE_CLIENT_ID env var and the google-auth library being installed —
until both are present (i.e. before deploy), any call raises a clean 400 so the
rest of auth keeps working.

Accepts a comma-separated GOOGLE_CLIENT_ID so the iOS, Android, and Web OAuth
client IDs from one Google Cloud project can all be trusted.
"""

import os
import secrets
from dataclasses import dataclass

from fastapi import HTTPException


@dataclass
class GoogleIdentity:
    email: str
    name: str
    sub: str
    email_verified: bool


def google_enabled() -> bool:
    return bool(os.environ.get("GOOGLE_CLIENT_ID"))


def _allowed_client_ids() -> list[str]:
    raw = os.environ.get("GOOGLE_CLIENT_ID", "")
    return [c.strip() for c in raw.split(",") if c.strip()]


def verify_google_token(id_token: str) -> GoogleIdentity:
    """Verify a Google ID token and return the identity, or raise HTTP 400."""
    if not id_token:
        raise HTTPException(status_code=400, detail="Missing Google token.")
    client_ids = _allowed_client_ids()
    if not client_ids:
        raise HTTPException(
            status_code=400,
            detail="Google sign-in is not configured on this server yet.",
        )
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Google sign-in support is not installed on this server yet.",
        )

    try:
        info = google_id_token.verify_oauth2_token(
            id_token, google_requests.Request()
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Google token.")

    # Audience must be one of our OAuth client IDs.
    if info.get("aud") not in client_ids:
        raise HTTPException(status_code=401, detail="Google token audience mismatch.")

    email = (info.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="Google account has no email.")

    return GoogleIdentity(
        email=email,
        name=(info.get("name") or email.split("@")[0]).strip(),
        sub=str(info.get("sub") or ""),
        email_verified=bool(info.get("email_verified", False)),
    )


def random_unusable_password_hash(hasher) -> str:
    """Give Google-only accounts a random, unguessable password hash so the
    email/password login path can never authenticate them until they set one."""
    return hasher(secrets.token_urlsafe(32))
