"""Gated email sending for team invites.

Sends a signup invite email IF SMTP is configured via env vars; otherwise
returns False so the caller can fall back to the invite code/link. This keeps
the invite flow working before an email service is wired up.

Env vars to enable at deploy:
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
  APP_SIGNUP_URL   (e.g. https://app.bloomprint.com/signup)
"""

import os
import smtplib
from email.message import EmailMessage


def email_enabled() -> bool:
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM"))


def send_team_invite_email(to_email: str, inviter_name: str, team_name: str, code: str) -> bool:
    if not email_enabled():
        return False
    signup_url = os.environ.get("APP_SIGNUP_URL", "").rstrip("/")
    link = f"{signup_url}?invite={code}" if signup_url else f"Invite code: {code}"
    try:
        msg = EmailMessage()
        msg["Subject"] = f"{inviter_name} invited you to {team_name} on BloomPrint"
        msg["From"] = os.environ["SMTP_FROM"]
        msg["To"] = to_email
        msg.set_content(
            f"{inviter_name} invited you to join the staff of \"{team_name}\" on BloomPrint.\n\n"
            f"Create your coach account to join:\n{link}\n\n"
            f"Your invite code: {code}\n"
        )
        host = os.environ["SMTP_HOST"]
        port = int(os.environ.get("SMTP_PORT", "587"))
        user = os.environ.get("SMTP_USER")
        password = os.environ.get("SMTP_PASSWORD")
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.starttls()
            if user and password:
                s.login(user, password)
            s.send_message(msg)
        return True
    except Exception:
        return False
