"""Closing an account, and calling it off.

Two endpoints on each side of one decision. Closing needs a session, because
only the person signed in may close their own account. Undoing must not, because
closing signs them out of everything — an undo that required a session would be
an undo nobody could reach.

The page is served here rather than by the app for that same reason, and looks
like the mail it was reached from. See api/account_deletion.py for what closing
does and, more importantly, what it deliberately does not do.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import get_current_coach
from ..database import get_db
from .. import account_deletion, emails, models, notify, ratelimit, schemas
from .player_auth import get_current_player_user

router = APIRouter(tags=["account"])

CREAM, CARD, INK, ACCENT = "#F7F2EA", "#FFFFFF", "#16242E", "#1F6F9B"
RTL = {"ar", "he"}


def _esc(s: str) -> str:
    import html
    return html.escape(s or "", quote=True)


def _page(lang: str, heading: str, body: str = "") -> HTMLResponse:
    d = "rtl" if (lang or "en").split("-")[0].lower() in RTL else "ltr"
    shell = emails.SHELL.get((lang or "en").split("-")[0].lower(),
                             emails.SHELL[emails.DEFAULT_LANG])
    return HTMLResponse(
        f"<!doctype html><html lang='{_esc(lang)}' dir='{d}'><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>BloomPrint</title><style>"
        f"body{{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;"
        f"background:{CREAM};color:{INK};display:grid;place-items:center;"
        "min-height:100vh;margin:0;padding:24px}"
        f".card{{background:{CARD};border-radius:16px;padding:32px;max-width:32rem;"
        "width:100%;box-sizing:border-box}"
        f".mark{{font-weight:800;letter-spacing:5px;font-size:15px;color:{INK};"
        "text-align:center;margin:0 0 26px}"
        "h1{font-size:1.3rem;line-height:1.4;margin:0 0 10px}"
        "p{margin:0 0 18px;color:#34424B;line-height:1.6}"
        f"a{{color:{ACCENT}}}</style>"
        "<div class=card><p class=mark>BLOOMPRINT</p>"
        f"<h1>{_esc(heading)}</h1>"
        + (f"<p>{_esc(body)}</p>" if body else "")
        + f"<p><a href='{_esc(emails.app_url())}'>{_esc(shell['open_cta'])}</a></p>"
        "</div></html>"
    )


def _close(db: Session, audience: str, account, event: str) -> dict:
    token = account_deletion.request(db, audience, account)
    link = emails.undo_deletion_url(token)
    # Read off the row before the pool gets to it; see notify's docstring.
    if audience == account_deletion.COACH:
        notify.coach_event(account, event, link=link)
    else:
        notify.player_event(account, event, link=link)
    return {"ok": True,
            "undo_until": (account.deleted_at + account_deletion.UNDO_WINDOW)
            .isoformat() + "Z"}


@router.delete("/auth/me")
def close_coach_account(db: Session = Depends(get_db),
                        coach: models.Coach = Depends(get_current_coach)):
    """Close this coach's account.

    Returns rather than raising when it is already closed: the dependency above
    refuses a closed account, so reaching here twice means two taps on one
    button, and the second should not read as an error.
    """
    return _close(db, account_deletion.COACH, coach, "account_closed")


@router.delete("/player-auth/me")
def close_player_account(db: Session = Depends(get_db),
                         pu: models.PlayerUser = Depends(get_current_player_user)):
    return _close(db, account_deletion.PLAYER, pu, "account_closed")


@router.get("/undo-deletion", response_class=HTMLResponse)
def undo_deletion(token: str = "", db: Session = Depends(get_db)):
    """Call off a deletion, from the link in the confirmation email.

    One click, like the decision links: this one only ever puts something back,
    so a mail scanner following it can do no harm — the worst case is an
    account that stays open, which is the safe direction to fail in.
    """
    row = account_deletion.pending(db, token)
    if row is None:
        shell = emails.SHELL[emails.DEFAULT_LANG]
        return _page("en", shell["decide_expired"])

    account = account_deletion.account_for(db, row)
    lang = getattr(account, "preferred_language", None) or "en"
    if not account_deletion.undo(db, row):
        shell = emails.SHELL.get(lang, emails.SHELL[emails.DEFAULT_LANG])
        return _page(lang, shell["decide_failed"])
    shell = emails.SHELL.get(lang, emails.SHELL[emails.DEFAULT_LANG])
    return _page(lang, shell["account_ready"])


class Credentials(BaseModel):
    email: str
    password: str


@router.post("/auth/reopen")
def reopen_coach_account(request: Request, body: Credentials,
                         db: Session = Depends(get_db)):
    """Reopen a closed coach account, on the strength of its own password.

    The way back that outlives the emailed link. Deliberately not a
    "recover by email address" form: the password is the proof, so this reveals
    nothing to anyone who does not already have it, and a wrong one answers
    exactly as a wrong password on the sign-in form does.
    """
    from ..auth import create_token, verify_password

    ratelimit.check(request, "coach-login")
    coach = db.query(models.Coach).filter(
        func.lower(models.Coach.email) == (body.email or "").strip().lower()
    ).first()
    if not coach or not verify_password(body.password, coach.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not account_deletion.is_closed(coach):
        # Already open. Nothing to do, and no reason to make that an error.
        return {"ok": True, "access_token": create_token(coach.id, coach.session_epoch),
                "coach": coach}
    account_deletion.reopen(db, account_deletion.COACH, coach)
    db.refresh(coach)
    return {"ok": True, "access_token": create_token(coach.id, coach.session_epoch),
            "coach": coach}


@router.post("/player-auth/reopen")
def reopen_player_account(request: Request, body: Credentials,
                          db: Session = Depends(get_db)):
    """The player's equivalent. See above."""
    from .player_auth import _make_token, _verify_pw

    ratelimit.check(request, "player-login")
    pu = db.query(models.PlayerUser).filter(
        func.lower(models.PlayerUser.email) == (body.email or "").strip().lower()
    ).first()
    if not pu or not _verify_pw(body.password, pu.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if account_deletion.is_closed(pu):
        account_deletion.reopen(db, account_deletion.PLAYER, pu)
        db.refresh(pu)
    return {"ok": True, "access_token": _make_token(pu.id, pu.session_epoch),
            "player_user": schemas.PlayerUserOut.model_validate(pu)}
