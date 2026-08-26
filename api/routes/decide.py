"""Answering a request by pressing a button in an email.

Unauthenticated, like the unsubscribe page and for the same reason: whoever
clicks is in a mail client, often on a device that has never signed in. The
token is the credential and it grants exactly one power — answering the one
request it was minted for.

ONE CLICK. Pressing Approve or Decline in the mail carries the decision out and
shows the result. There is no confirmation step, by decision: the whole point
is not having to go anywhere.

The cost of that, stated plainly because it is real and not visible from the
outside: some mail systems fetch the links in a message before a person opens
it, and a fetch of one of these links is a decision. Where that happens the
request will settle without the recipient pressing anything. Three things limit
it — a token works once, dies after seven days, and answers exactly one request
for exactly one person — but they limit the blast radius, not the event. The
app's own screens remain the authority for anyone who would rather look first,
and every one of these emails still carries the link into them.
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


def _answer(db: Session, token: str, choice: str) -> HTMLResponse:
    """Carry out the decision and say what happened, in the reader's language.

    One body for both methods so the two can never come to mean different
    things. GET is what the button in the email is; POST exists because a
    browser that turns the result page into a form post should not break.
    """
    row = decisions.lookup(db, token)
    if row is None:
        shell = _shell("en")
        return _page("en", shell["decide_expired"], "", _open_link("en"))

    account = decisions.account_for(db, row)
    lang = getattr(account, "preferred_language", None) or "en"
    shell = _shell(lang)

    outcome = decisions.decide(db, row, "reject" if choice == "reject" else "approve")
    heading = {
        "approved": shell["decide_approved"],
        "rejected": shell["decide_rejected"],
        # Answered in the app, withdrawn, or this link already used. Said
        # rather than shown as a failure: nothing is wrong, it is just done.
        "gone": shell["decide_gone"],
    }.get(outcome, shell["decide_failed"])
    # What was being asked, kept on the result page: somebody who pressed a
    # button in a mail they half-read should be able to see what they answered.
    body = _describe(db, row, lang) if outcome in ("approved", "rejected") else ""
    return _page(lang, heading, body, _open_link(lang))


@router.get("/decide", response_class=HTMLResponse)
def act_get(token: str = "", choice: str = "approve",
            db: Session = Depends(get_db)):
    """The button in the email. One click, and it is done."""
    return _answer(db, token, choice)


@router.post("/decide", response_class=HTMLResponse)
def act_post(token: str = Form(""), choice: str = Form("approve"),
             db: Session = Depends(get_db)):
    return _answer(db, token, choice)
