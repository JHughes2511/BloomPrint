"""One-click opt-out from activity email.

Deliberately unauthenticated: the link is clicked from a mail client, often on
a device that has never signed in. The token is the credential, and it grants
exactly one power — turning this account's activity email off.

Answers HTML because a person clicked a link and a person should see a page.
"""
from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .player_auth import get_current_player_user
from .. import emails, models, notify

router = APIRouter(tags=["unsubscribe"])


def _page(title: str, message: str, lang: str = "en") -> HTMLResponse:
    """The same card the emails and the decision pages use.

    It used to be a dark panel of its own, which made the one page reached from
    a message look like it belonged to a different product.
    """
    d = "rtl" if (lang or "en").split("-")[0].lower() in {"ar", "he"} else "ltr"
    esc = __import__("html").escape
    return HTMLResponse(
        f"<!doctype html><html lang='{esc(lang)}' dir='{d}'><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{esc(title)}</title><style>"
        "body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;"
        "background:#F7F2EA;color:#16242E;display:grid;place-items:center;"
        "min-height:100vh;margin:0;padding:24px}"
        ".card{background:#FFFFFF;border-radius:16px;padding:32px;max-width:32rem;"
        "width:100%;box-sizing:border-box}"
        ".mark{font-weight:800;letter-spacing:5px;font-size:15px;color:#16242E;"
        "text-align:center;margin:0 0 26px}"
        "h1{font-size:1.3rem;line-height:1.4;margin:0 0 10px}"
        "p{margin:0;color:#34424B;line-height:1.6}</style>"
        "<div class=card><p class=mark>BLOOMPRINT</p>"
        f"<h1>{esc(title)}</h1><p>{esc(message)}</p></div></html>"
    )


@router.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe(token: str = "", db: Session = Depends(get_db)):
    """Turn off activity email for whoever holds this token.

    An unknown token says so plainly rather than pretending to have worked —
    someone who thinks they have unsubscribed and keeps receiving mail has been
    told something false.
    """
    pref = db.query(models.EmailPreference).filter_by(token=token).one_or_none() if token else None
    if pref is None:
        # No row means no account, so there is no language to answer in.
        # English is not a choice here, it is the only thing left.
        return _page(
            "Link not recognised",
            "This unsubscribe link is not one we issued, or it has been replaced. "
            "You can turn email off in BloomPrint under settings.",
        )
    if not pref.opted_out:
        pref.opted_out = True
        db.commit()

    # Answered in the reader's own language. They reached this page from a
    # message we had already written to them in it, so an English page here
    # reads like something went wrong.
    model = models.Coach if pref.audience == notify.COACH else models.PlayerUser
    account = db.get(model, pref.user_id)
    lang = (getattr(account, "preferred_language", None) or emails.DEFAULT_LANG)
    shell = emails.SHELL.get(lang.split("-")[0].lower(),
                             emails.SHELL[emails.DEFAULT_LANG])
    return _page(shell["unsub_done_title"], shell["unsub_done_body"], lang)


# ── In-app setting ────────────────────────────────────────────────────────────
#
# The same preference the emailed link writes, reachable from the app so it can
# be turned off before the first message rather than only after one arrives.

class EmailPrefIn(BaseModel):
    email_enabled: bool


@router.get("/auth/email-prefs")
def coach_email_prefs(coach: models.Coach = Depends(get_current_coach)):
    return {"email_enabled": not notify.is_opted_out(notify.COACH, coach.id)}


@router.patch("/auth/email-prefs")
def set_coach_email_prefs(body: EmailPrefIn,
                          coach: models.Coach = Depends(get_current_coach)):
    opted_out = notify.set_opted_out(notify.COACH, coach.id, not body.email_enabled)
    return {"email_enabled": not opted_out}


@router.get("/player-auth/email-prefs")
def player_email_prefs(pu: models.PlayerUser = Depends(get_current_player_user)):
    return {"email_enabled": not notify.is_opted_out(notify.PLAYER, pu.id)}


@router.patch("/player-auth/email-prefs")
def set_player_email_prefs(body: EmailPrefIn,
                           pu: models.PlayerUser = Depends(get_current_player_user)):
    opted_out = notify.set_opted_out(notify.PLAYER, pu.id, not body.email_enabled)
    return {"email_enabled": not opted_out}
