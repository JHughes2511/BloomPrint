"""The page an approve-or-decline button in an email opens.

Unauthenticated, like the unsubscribe page and for the same reason: whoever
clicks is in a mail client, often on a device that has never signed in. The
token is the credential and it grants exactly one power — answering the one
request it was minted for.

GET shows what is being asked and one button. POST is the answer. That split is
the whole point of this file: mail scanners follow links, so a GET that decided
something would be decided by a machine before a person saw it. See
api/decisions.py.
"""
from fastapi import APIRouter, Depends, Form
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from ..database import get_db
from .. import decisions, emails, models

router = APIRouter(tags=["decide"])

# The email's palette, so the page a button opens looks like the mail it came
# from rather than like a different product.
CREAM, CARD, INK, MUTED = "#F7F2EA", "#FFFFFF", "#16242E", "#8A8174"
ACCENT, CHIP = "#1F6F9B", "#EFE8DC"
RTL = {"ar", "he"}


def _esc(s: str) -> str:
    import html
    return html.escape(s or "", quote=True)


def _page(lang: str, heading: str, body: str = "", form: str = "") -> HTMLResponse:
    rtl = (lang or "en").split("-")[0].lower() in RTL
    d = "rtl" if rtl else "ltr"
    return HTMLResponse(
        f"<!doctype html><html lang='{_esc(lang)}' dir='{d}'><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>BloomPrint</title>"
        "<style>"
        f"body{{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;"
        f"background:{CREAM};color:{INK};display:grid;place-items:center;"
        "min-height:100vh;margin:0;padding:24px}"
        f".card{{background:{CARD};border-radius:16px;padding:32px;max-width:32rem;"
        "width:100%;box-sizing:border-box}"
        f".mark{{font-weight:800;letter-spacing:5px;font-size:15px;color:{INK};"
        "text-align:center;margin:0 0 26px}"
        "h1{font-size:1.3rem;line-height:1.4;margin:0 0 10px}"
        f"p{{margin:0 0 18px;color:#34424B;line-height:1.6}}"
        "button{display:block;width:100%;padding:15px 24px;font-size:16px;"
        "font-weight:600;border:0;border-radius:10px;cursor:pointer;"
        "font-family:inherit;margin:0 0 10px}"
        f".yes{{background:{ACCENT};color:#fff}}"
        f".no{{background:{CHIP};color:{INK}}}"
        f"a{{color:{ACCENT}}}"
        "</style>"
        "<div class=card><p class=mark>BLOOMPRINT</p>"
        f"<h1>{_esc(heading)}</h1>"
        + (f"<p>{_esc(body)}</p>" if body else "")
        + form + "</div></html>"
    )


def _open_link(lang: str) -> str:
    shell = emails.SHELL.get((lang or "en").split("-")[0].lower(),
                             emails.SHELL[emails.DEFAULT_LANG])
    return (f"<p><a href='{_esc(emails.app_url())}'>"
            f"{_esc(shell['open_cta'])}</a></p>")


def _describe(db: Session, row: models.DecisionToken, lang: str) -> str:
    """What is being asked, in the reader's language.

    Built from the same notification copy the email used, so the page repeats
    the email rather than paraphrasing it. Silent when there is nothing to say
    — a heading and a button are enough to answer with.
    """
    key, params = None, {}
    if row.kind == "share_approval":
        a = db.get(models.ShareApproval, row.target_id)
        if a:
            coach = db.get(models.Coach, a.coach_id)
            recip = db.get(models.PlayerUser, a.recipient_player_user_id)
            key, params = "shareApproval", {
                "coach": coach.name if coach else "",
                "type": a.output_type,
                "recipient": recip.name if recip else "",
            }
    elif row.kind == "team_join_request":
        req = db.get(models.TeamInvite, row.target_id)
        if req:
            asker = db.get(models.Coach, req.invited_coach_id)
            team = db.get(models.Team, req.team_id)
            key, params = "teamJoinRequest", {
                "coach": asker.name if asker else "",
                "role": (asker.role if asker else None) or "staff",
                "team": team.name if team else "",
            }
    elif row.kind == "team_invite":
        inv = db.get(models.TeamInvite, row.target_id)
        if inv:
            team = db.get(models.Team, inv.team_id)
            inviter = db.get(models.Coach, inv.invited_by)
            key, params = "teamInvite", {
                "coach": inviter.name if inviter else "",
                "team": team.name if team else "",
            }
    elif row.kind == "roster_proposal":
        prop = db.get(models.RosterProposal, row.target_id)
        if prop:
            by = db.get(models.Coach, prop.proposed_by)
            player = db.get(models.Player, prop.player_id)
            team = db.get(models.Team, prop.team_id)
            key, params = "rosterPlayerProposed", {
                "coach": by.name if by else "",
                "player": player.name if player else "",
                "team": team.name if team else "",
            }
    elif row.kind == "player_link_request":
        lr = db.get(models.LinkRequest, row.target_id)
        if lr:
            asker = db.get(models.PlayerUser, lr.player_user_id)
            profile = db.get(models.Player, lr.player_id)
            key, params = "linkRequest", {
                "player": asker.name if asker else "",
                "profile": profile.name if profile else "",
            }
    if not key:
        return ""
    pair = emails.notification_copy(key, lang, params)
    return pair[1] if pair else ""


def _shell(lang: str) -> dict:
    return emails.SHELL.get((lang or "en").split("-")[0].lower(),
                            emails.SHELL[emails.DEFAULT_LANG])


@router.get("/decide", response_class=HTMLResponse)
def show(token: str = "", choice: str = "approve",
         db: Session = Depends(get_db)):
    """Show what is being asked, with one button to confirm it.

    Nothing is decided here. This handler is what a mail scanner reaches, and
    all it does is read.
    """
    row = decisions.lookup(db, token)
    if row is None:
        shell = _shell("en")
        return _page("en", shell["decide_expired"], "", _open_link("en"))

    account = decisions.account_for(db, row)
    lang = getattr(account, "preferred_language", None) or "en"
    shell = _shell(lang)

    if not decisions.still_pending(db, row):
        return _page(lang, shell["decide_gone"], "", _open_link(lang))

    pick = "approve" if choice != "reject" else "reject"
    label = shell["decide_approve"] if pick == "approve" else shell["decide_reject"]
    form = (
        f"<form method=post action='/decide'>"
        f"<input type=hidden name=token value='{_esc(token)}'>"
        f"<input type=hidden name=choice value='{pick}'>"
        f"<button class='{'yes' if pick == 'approve' else 'no'}' type=submit>"
        f"{_esc(label)}</button></form>"
        # The other answer, in case they pressed the wrong button in the mail.
        f"<form method=get action='/decide'>"
        f"<input type=hidden name=token value='{_esc(token)}'>"
        f"<input type=hidden name=choice value="
        f"'{'reject' if pick == 'approve' else 'approve'}'>"
        f"<button class='{'no' if pick == 'approve' else 'yes'}' type=submit>"
        f"{_esc(shell['decide_reject'] if pick == 'approve' else shell['decide_approve'])}"
        f"</button></form>"
    )
    return _page(lang, shell["decide_ask"], _describe(db, row, lang), form)


@router.post("/decide", response_class=HTMLResponse)
def act(token: str = Form(""), choice: str = Form("approve"),
        db: Session = Depends(get_db)):
    """The answer. Only reached by pressing the button on the page above."""
    row = decisions.lookup(db, token)
    if row is None:
        shell = _shell("en")
        return _page("en", shell["decide_expired"], "", _open_link("en"))

    account = decisions.account_for(db, row)
    lang = getattr(account, "preferred_language", None) or "en"
    shell = _shell(lang)

    outcome = decisions.decide(db, row, "approve" if choice != "reject" else "reject")
    heading = {
        "approved": shell["decide_approved"],
        "rejected": shell["decide_rejected"],
        "gone": shell["decide_gone"],
    }.get(outcome, shell["decide_failed"])
    return _page(lang, heading, "", _open_link(lang))
