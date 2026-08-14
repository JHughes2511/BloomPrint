"""Turning a report into a file the coach can keep.

The app used to build the PDF on the device. On the web that meant expo-print,
which is a stub there — so Export PDF threw on every browser and Print printed
whatever was on screen. Building it here means one implementation for the web,
the iPad and the phone, and a real download rather than a print dialog.

The client sends the text it is showing, already filtered to the sections the
coach ticked, so what comes back is exactly what was on screen. It is not
re-fetched from the database here on purpose: the coach may have switched half
the sections off, and a server that went and got "the report" would quietly
hand back the parts they had just excluded.
"""
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from ..auth import get_current_coach
from .. import models, pdf_report

router = APIRouter(prefix="/exports", tags=["exports"])

MAX_TITLE = 200
MAX_TEXT = 2_000_000


class PdfIn(BaseModel):
    title: str
    # The print document the app would otherwise have printed. Sent rather
    # than rebuilt here so the exported file and the printed page are the same
    # document — see api/pdf_report.py.
    html: str


def _filename(title: str) -> str:
    """A name a phone and a desktop will both accept, and a person can read.

    Only characters a file system refuses are removed. Stripping everything
    non-ASCII named a Russian coach's report "Report.pdf" and a Chinese one
    "vs.pdf" — their own title discarded for not being in Latin letters.
    """
    safe = re.sub(r'[/\\:*?"<>|]', "", (title or "Report"))
    safe = re.sub(r"[\x00-\x1f\x7f]", "", safe)
    safe = re.sub(r"\s+", " ", safe).strip()[:80] or "Report"
    return f"{safe}.pdf"


def _disposition(name: str) -> str:
    """Content-Disposition that carries a non-Latin name intact.

    A header is Latin-1, so the name is given twice: an ASCII fallback for
    anything old, and the real one RFC 5987-encoded for everything else.
    """
    ascii_name = name.encode("ascii", "ignore").decode() or "Report.pdf"
    if ascii_name.strip(". ") in ("", "pdf"):
        ascii_name = "Report.pdf"
    quoted = quote(name, safe="")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quoted}"


@router.post("/pdf")
def export_pdf(
    body: PdfIn,
    coach: models.Coach = Depends(get_current_coach),
):
    html = (body.html or "").strip()
    if not html:
        raise HTTPException(status_code=400, detail="There is nothing to export.")

    try:
        pdf = pdf_report.build_pdf_from_html(html[:MAX_TEXT], (body.title or "Report")[:MAX_TITLE])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # The coach gets a sentence, not a stack trace — and the log gets the
        # detail, because a PDF that will not build is about the text it was
        # given and is otherwise impossible to reproduce.
        import logging
        logging.getLogger(__name__).exception("PDF export failed")
        raise HTTPException(status_code=500,
                            detail="That report could not be turned into a PDF.") from exc

    name = _filename(body.title)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            # attachment, so a browser saves it instead of navigating to it.
            "Content-Disposition": _disposition(name),
            "Content-Length": str(len(pdf)),
        },
    )
