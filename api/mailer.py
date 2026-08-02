"""One way to send mail, for every feature that needs to.

Prefers Resend's HTTP API and falls back to SMTP, so the app works with either
and neither has to be configured for the rest of the app to run — every send
returns a bool and nothing raises. Email is a side effect: a coach's feedback
must still be saved, and a signup must still succeed, when mail is down or was
never set up.

Env:
  RESEND_API_KEY   enables Resend (preferred)
  MAIL_FROM        default sender, e.g. "BloomPrint <noreply@bloomprint.org>"
  FEEDBACK_FROM    sender for the internal feedback notification
  FEEDBACK_TO      where in-app feedback is delivered
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD   fallback transport

A mailbox that sends to itself is widely treated as spoofing and gets bounced,
so FEEDBACK_FROM and FEEDBACK_TO must be different addresses.
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


def feedback_from() -> str:
    """Sender for the internal feedback notification.

    Kept separate from MAIL_FROM so the notification isn't sent from the same
    mailbox it's delivered to — receiving servers reject a message that claims
    to come from their own domain but arrives from a third-party sender.
    """
    return os.environ.get("FEEDBACK_FROM") or mail_from()


def mail_enabled() -> bool:
    return bool(os.environ.get("RESEND_API_KEY") or os.environ.get("SMTP_HOST"))


def _send_resend(to: str, subject: str, text: str, html: str | None,
                 from_addr: str, reply_to: str | None) -> bool:
    import json
    import urllib.request

    payload = {"from": from_addr, "to": [to], "subject": subject, "text": text}
    if html:
        payload["html"] = html
    if reply_to:
        payload["reply_to"] = [reply_to]
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


def _send_smtp(to: str, subject: str, text: str, html: str | None,
               from_addr: str, reply_to: str | None) -> bool:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to
    if reply_to:
        msg["Reply-To"] = reply_to
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


def _explain(exc: Exception) -> str:
    """Turn a send failure into something a person can act on.

    A provider's refusal arrives as an HTTP error whose body carries the actual
    reason — an unverified domain, a rejected sender. That body is the useful
    part and is otherwise discarded, leaving only a stack type to go on.
    """
    import urllib.error
    if isinstance(exc, urllib.error.HTTPError):
        try:
            body = exc.read().decode("utf-8", "replace").strip()[:500]
        except Exception:
            body = ""
        return f"provider returned HTTP {exc.code}: {body or exc.reason}"
    return f"{type(exc).__name__}: {exc}"


def try_send(to: str, subject: str, text: str, html: str | None = None, *,
             from_addr: str | None = None, reply_to: str | None = None) -> tuple[bool, str]:
    """Send one email, reporting why if it didn't go. Never raises.

    Same work as send_email, with the reason kept rather than dropped, so a
    diagnostic caller can say what went wrong instead of only that something
    did. Ordinary callers want send_email.
    """
    if not to:
        return False, "no destination address"
    sender = from_addr or mail_from()
    try:
        if os.environ.get("RESEND_API_KEY"):
            ok = _send_resend(to, subject, text, html, sender, reply_to)
            return ok, "sent via Resend" if ok else "Resend accepted the request but did not confirm"
        if os.environ.get("SMTP_HOST"):
            ok = _send_smtp(to, subject, text, html, sender, reply_to)
            return ok, "sent via SMTP" if ok else "SMTP accepted the request but did not confirm"
    except Exception as exc:
        detail = _explain(exc)
        log.warning("Email to %s failed (%s): %s", to, subject, detail)
        return False, detail
    log.info("Email not sent (no provider configured): %s -> %s", subject, to)
    return False, "no email provider configured (set RESEND_API_KEY or SMTP_HOST)"


def send_email(to: str, subject: str, text: str, html: str | None = None, *,
               from_addr: str | None = None, reply_to: str | None = None) -> bool:
    """Send one email. Returns whether it went out; never raises.

    `reply_to` is what makes a noreply@ sender usable: the message still comes
    from an address nobody monitors, but hitting Reply reaches someone real.

    A caller that wants to know it failed can check the return value, but no
    caller should have its own work fail because mail did.
    """
    return try_send(to, subject, text, html, from_addr=from_addr, reply_to=reply_to)[0]
