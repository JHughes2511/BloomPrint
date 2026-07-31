"""One way to send mail, for every feature that needs to.

Prefers Resend's HTTP API and falls back to SMTP, so the app works with either
and neither has to be configured for the rest of the app to run — every send
returns a bool and nothing raises. Email is a side effect: a coach's feedback
must still be saved, and a signup must still succeed, when mail is down or was
never set up.

Env:
  RESEND_API_KEY   enables Resend (preferred)
  MAIL_FROM        sending address, e.g. "BloomPrint <noreply@bloomprint.org>"
  FEEDBACK_TO      where in-app feedback is delivered (defaults to MAIL_FROM)
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD   fallback transport
"""
import logging
import os
import smtplib
from email.message import EmailMessage

log = logging.getLogger(__name__)

DEFAULT_FROM = "BloomPrint <noreply@bloomprint.org>"


def mail_from() -> str:
    return os.environ.get("MAIL_FROM") or os.environ.get("SMTP_FROM") or DEFAULT_FROM


def feedback_to() -> str:
    return os.environ.get("FEEDBACK_TO") or mail_from()


def mail_enabled() -> bool:
    return bool(os.environ.get("RESEND_API_KEY") or os.environ.get("SMTP_HOST"))


def _send_resend(to: str, subject: str, text: str, html: str | None) -> bool:
    import json
    import urllib.request

    payload = {"from": mail_from(), "to": [to], "subject": subject, "text": text}
    if html:
        payload["html"] = html
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {os.environ['RESEND_API_KEY']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return 200 <= resp.status < 300


def _send_smtp(to: str, subject: str, text: str, html: str | None) -> bool:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = mail_from()
    msg["To"] = to
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
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


def send_email(to: str, subject: str, text: str, html: str | None = None) -> bool:
    """Send one email. Returns whether it went out; never raises.

    A caller that wants to know it failed can check the return value, but no
    caller should have its own work fail because mail did.
    """
    if not to:
        return False
    try:
        if os.environ.get("RESEND_API_KEY"):
            return _send_resend(to, subject, text, html)
        if os.environ.get("SMTP_HOST"):
            return _send_smtp(to, subject, text, html)
    except Exception as exc:
        log.warning("Email to %s failed (%s): %s", to, subject, exc)
        return False
    log.info("Email not sent (no provider configured): %s -> %s", subject, to)
    return False
