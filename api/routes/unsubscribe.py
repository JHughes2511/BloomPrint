"""One-click opt-out from activity email.

Deliberately unauthenticated: the link is clicked from a mail client, often on
a device that has never signed in. The token is the credential, and it grants
exactly one power — turning this account's activity email off.

Answers HTML because a person clicked a link and a person should see a page.
"""
from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models

router = APIRouter(tags=["unsubscribe"])


def _page(title: str, message: str) -> HTMLResponse:
    return HTMLResponse(
        "<!doctype html><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{title}</title>"
        "<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;"
        "background:#0f1c22;color:#e8eef1;display:grid;place-items:center;"
        "min-height:100vh;margin:0;padding:24px}"
        "div{max-width:28rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}"
        "p{margin:0;color:#9fb3bd;line-height:1.5}</style>"
        f"<div><h1>{title}</h1><p>{message}</p></div>"
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
        return _page(
            "Link not recognised",
            "This unsubscribe link is not one we issued, or it has been replaced. "
            "You can turn email off in BloomPrint under settings.",
        )
    if not pref.opted_out:
        pref.opted_out = True
        db.commit()
    return _page(
        "Unsubscribed",
        "You won't get email about other people's activity any more. "
        "Messages about your own account will still be sent.",
    )
