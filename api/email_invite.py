"""The invite sent to someone who does not have an account yet.

Kept separate from notify.py because the recipient is not a user: there is no
row to read a language from, no preference to honour, and nothing to
unsubscribe from — they asked for nothing, and this one message is the whole
relationship until they sign up.

It used to speak SMTP directly, gated on SMTP_HOST and SMTP_FROM. Those are
unset wherever Resend is configured, so email_enabled() was always False and
every invite silently fell back to reading the code aloud. Going through the
mailer means it uses whichever transport the rest of the app uses.

Env:
  APP_SIGNUP_URL   where an invited person lands (defaults to the app's origin)
"""
import os

from .emails import DEFAULT_LANG, app_url, render
from .mailer import mail_enabled, mail_from, send_email


def email_enabled() -> bool:
    """Whether an invite can be emailed at all.

    Asks the mailer rather than checking SMTP env directly, so a Resend-only
    deployment reports the truth. Callers use this to decide whether to fall
    back to showing the invite code.
    """
    return mail_enabled()


def signup_link(code: str) -> str:
    """Where an invited person goes to accept."""
    base = (os.environ.get("APP_SIGNUP_URL") or app_url()).rstrip("/")
    return f"{base}?invite={code}"


def send_team_invite_email(to_email: str, inviter_name: str, team_name: str,
                           code: str) -> bool:
    """Invite someone with no account to join a team's staff.

    English, because no account means no language preference yet. Uses the same
    copy as every other staff invite so the two cannot drift apart.
    """
    if not to_email:
        return False
    subject, body = render(
        "staff_invite", DEFAULT_LANG,
        {"inviter": inviter_name, "team": team_name},
        link=signup_link(code),
    )
    # The code is what keeps the invite usable if the link is mangled in
    # transit or read on a device that cannot open it.
    body = body.rstrip("\n") + f"\n\nInvite code: {code}\n"
    return send_email(to_email, subject, body, from_addr=mail_from())
