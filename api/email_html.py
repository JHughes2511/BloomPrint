"""What an email looks like.

The same words `emails.render` already produces, laid out. Every message keeps
its plain-text version — that is what a screen reader reads, what a text-only
client shows, and what survives when the HTML is stripped — so this is the
second half of a message, never the whole of one.

CEREMONY SCALES WITH THE NEWS

Two layouts, not one. A signup or a finished password reset gets the banner: a
dark panel, a large headline, room around it. Everything else — a share, a
comment, an invite, a job that finished — gets the plain layout: the wordmark,
a sentence, and one link.

That split is the whole design. Most of what this app sends is a notification,
and a gradient banner over "Ashten commented on your report" reads as
marketing, which is how a sender teaches people to skim past everything it
sends including the one message that mattered.

WRITTEN FOR MAIL CLIENTS, NOT FOR BROWSERS

Tables and inline styles, because Outlook renders with Word's engine: no
flexbox, no grid, no <style> block worth relying on. Nothing that carries
meaning lives in an image — Gmail, Outlook and Apple Mail all block remote
images until the reader allows them, so an image is decoration or it is a
mistake. The wordmark is letterspaced text for exactly that reason.
"""
from __future__ import annotations

import html as _html
import re

# The app's own palette. A coach should recognise the mail as the same product.
CREAM = "#F7F2EA"      # page behind the card — the light canvas gradient's top
CARD = "#FFFFFF"
INK = "#16242E"
INK_SOFT = "#34424B"
MUTED = "#8A8174"
ACCENT = "#1F6F9B"     # links and the button
# NOT the dark theme's #41B8E8. That is the accent the app uses on a dark
# canvas, and dropping it into a light-mode design gave a harsh cyan on navy
# that appears nowhere in the app.
BANNER_BG = "#16242E"
BANNER_FG = "#FFFFFF"
BANNER_KICKER = "#A9BCC7"
CHIP = "#EFE8DC"       # the quiet footer card
LINE = "#E1D9CA"

# Hanken Grotesk is the app's face and cannot be relied on in mail, so this is
# the closest stack that is already on the reader's machine.
FONT = ("-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,"
        "'Helvetica Neue',Arial,sans-serif")

RTL_LANGS = {"ar", "he"}


def _esc(s: str) -> str:
    return _html.escape(s or "", quote=True)


def _bold(escaped: str) -> str:
    """**like this** becomes bold.

    Applied after escaping, so a body containing a literal < is still safe and
    the only markup that can reach the page is the tag put there on purpose.
    """
    return re.sub(r"\*\*(.+?)\*\*",
                  rf'<strong style="color:{INK}">\1</strong>', escaped)


def _bullets(lines: list[str], align: str) -> str:
    """A block whose every line starts with "- " becomes a list.

    Built from table rows rather than <ul>, because Outlook indents and bullets
    a list to its own taste and ignores most of what CSS asks for. A row with a
    dot in the first cell renders the same everywhere.
    """
    rows = ""
    pad = "padding-left" if align == "left" else "padding-right"
    for line in lines:
        rows += (
            f'<tr>'
            f'<td valign="top" style="width:14px;font-size:16px;line-height:26px;'
            f'color:{ACCENT}">&bull;</td>'
            f'<td style="font-size:16px;line-height:26px;color:{INK_SOFT};'
            f'{pad}:8px;padding-bottom:6px;text-align:{align}">'
            f'{_bold(_esc(line))}</td></tr>'
        )
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0"'
            f' style="margin:0 0 18px" dir="{"rtl" if align == "right" else "ltr"}">'
            f'{rows}</table>')


def _paragraphs(body: str, align: str) -> str:
    """The message, one <p> per blank-line-separated block, or a list."""
    out = []
    for block in [b.strip() for b in (body or "").split("\n\n") if b.strip()]:
        lines = [l.strip() for l in block.splitlines() if l.strip()]
        if lines and all(l.startswith("- ") for l in lines):
            out.append(_bullets([l[2:].strip() for l in lines], align))
            continue
        out.append(
            f'<p style="margin:0 0 18px;font-size:16px;line-height:26px;'
            f'color:{INK_SOFT};text-align:{align}">{_bold(_esc(block))}</p>'
        )
    return "".join(out)


def _button(label: str, url: str, rtl: bool, bg: str = ACCENT) -> str:
    """Full width and rounded, the way the app's own buttons are.

    Wrapped in a table because a padded <a> is the one button shape Outlook
    renders at the right height.
    """
    return f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           border="0" style="margin:6px 0 22px">
      <tr><td align="center" bgcolor="{bg}" style="border-radius:10px">
        <a href="{_esc(url)}" style="display:block;padding:15px 24px;
           font-family:{FONT};font-size:16px;font-weight:600;color:#FFFFFF;
           text-decoration:none;border-radius:10px">{_esc(label)}</a>
      </td></tr>
    </table>"""


def _banner(headline: str, kicker: str | None, rtl: bool,
            bg: str = BANNER_BG, fg: str = BANNER_FG,
            kicker_fg: str = BANNER_KICKER) -> str:
    """The dark panel, for the handful of messages that earn one.

    A flat colour rather than a gradient: Outlook drops CSS gradients entirely
    and shows the fallback, so the fallback is the design.
    """
    align = "right" if rtl else "left"
    kick = (f'<p style="margin:0 0 10px;font-size:15px;line-height:22px;'
            f'color:{kicker_fg};text-align:{align}">{_esc(kicker)}</p>') if kicker else ""
    return f"""
    <tr><td bgcolor="{bg}" style="padding:34px 32px 38px;background-color:{bg}">
      {kick}
      <h1 style="margin:0;font-size:30px;line-height:38px;font-weight:700;
          letter-spacing:-0.5px;color:{fg};text-align:{align}">{_esc(headline)}</h1>
    </td></tr>"""


def build(
    *,
    body: str,
    lang: str = "en",
    greeting: str | None = None,
    headline: str | None = None,
    kicker: str | None = None,
    banner_bg: str = BANNER_BG,
    banner_fg: str = BANNER_FG,
    banner_kicker_fg: str = BANNER_KICKER,
    cta_label: str | None = None,
    cta_url: str | None = None,
    # Navy when the banner is already wearing the accent, so the panel and the
    # button are not the same blue arguing with each other.
    cta_bg: str = ACCENT,
    contact: str | None = None,
    contact_address: str | None = None,
    unsub: str | None = None,
    unsub_url: str | None = None,
    unsub_label: str | None = None,
) -> str:
    """One message, laid out. `headline` present means the banner layout."""
    rtl = (lang or "en").split("-")[0].lower() in RTL_LANGS
    align = "right" if rtl else "left"
    dir_attr = "rtl" if rtl else "ltr"

    head = (_banner(headline, kicker, rtl, banner_bg, banner_fg, banner_kicker_fg)
            if headline else "")

    greet = ""
    if greeting:
        greet = (f'<p style="margin:0 0 18px;font-size:16px;line-height:26px;'
                 f'color:{INK};font-weight:600;text-align:{align}">{_esc(greeting)}</p>')

    cta = _button(cta_label, cta_url, rtl, cta_bg) if cta_label and cta_url else ""

    lines = []
    # The contact line is on every message. A reader with a question should
    # never have to work out where to send it, and the address this came FROM
    # is a bin.
    if contact and contact_address:
        lines.append(
            f'<p style="margin:0;font-size:13px;line-height:20px;color:{MUTED};'
            f'text-align:{align}">{_esc(contact)} '
            f'<a href="mailto:{_esc(contact_address)}" style="color:{ACCENT}">'
            f'{_esc(contact_address)}</a></p>'
        )
    # The opt-out only where there is something to opt out of. Account mail is
    # the consequence of something the reader just did.
    if unsub and unsub_url and unsub_label:
        lines.append(
            f'<p style="margin:10px 0 0;font-size:13px;line-height:20px;'
            f'color:{MUTED};text-align:{align}">{_esc(unsub)} '
            f'<a href="{_esc(unsub_url)}" style="color:{ACCENT}">'
            f'{_esc(unsub_label)}</a></p>'
        )
    foot = ""
    if lines:
        foot = f"""
        <tr><td style="padding:0 32px 32px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 border="0" style="background-color:{CHIP};border-radius:12px">
            <tr><td style="padding:18px 20px">{"".join(lines)}</td></tr>
          </table>
        </td></tr>"""

    return f"""<!doctype html>
<html dir="{dir_attr}" lang="{_esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Told, not guessed at: without this a client picks a scheme for us and
     inverts the palette unevenly. -->
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:{CREAM};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:{CREAM};padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:100%;max-width:600px;background-color:{CARD};
                    border-radius:16px;overflow:hidden;font-family:{FONT}">

        <tr><td align="center" style="padding:30px 32px 26px">
          <!-- Type, not an image. A blocked logo is a blank space where the
               sender's name should be. -->
          <span style="font-size:19px;font-weight:800;letter-spacing:5px;
                       color:{INK}">BLOOMPRINT</span>
        </td></tr>

        {head}

        <tr><td style="padding:{'30px 32px 6px' if headline else '4px 32px 6px'}">
          {greet}
          {_paragraphs(body, align)}
          {cta}
        </td></tr>

        {foot}
      </table>
    </td></tr>
  </table>
</body>
</html>"""
