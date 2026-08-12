"""The public discovery questionnaire, and the results behind it.

Two audiences, two levels of access, in one file because they are two halves of
one thing.

ANYONE can read the questions and submit an answer. That is the point — the
people being asked have never heard of BloomPrint and are not going to make an
account to answer six questions about their week. So this is the only unauthed
write in the app, and it is written like one: rate limited per IP, every field
length-capped, answers validated against the server's own question list rather
than trusted, and nothing in the payload reaching a template or a prompt.

THE RESULTS are also public, and guarded by a passcode rather than a login.
The owner reads them on a phone, on a laptop, signed in or not, and every
notification email carries the link — so requiring a session would mean the
link in the email only worked half the time. Responses carry names, so the
passcode is what stands between them and anyone who guesses the URL: it is a
32-character key, it is never in the repository, and a wrong one is refused
with the same 403 whether it was close or nothing like it. A signed-in coach
is also let through, because someone who already proved who they are should
not have to find the key again.

WHY A SUMMARY ENDPOINT AND NOT JUST THE ROWS

Thirty responses is a pile of JSON and no picture. The summary counts every
option of every question per role, which is the shape the answers were designed
to be read in — five roles answering the same seven positions, laid side by
side. The rows are still there for reading the free text, which is where the
quotes come from.
"""
import hashlib
import hmac
import json
import logging
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..ai_models import SONNET
from ..coach_context import LANGUAGE_NAMES
from .. import appsecrets, models, ratelimit, mailer, questionnaire_content as content

log = logging.getLogger(__name__)

router = APIRouter(prefix="/questionnaire", tags=["questionnaire"])

MAX_NAME = 80
MAX_EMAIL = 120
MAX_COMMENT = 2000
MAX_SOURCE = 40

# Generous for a real person filling one in, and enough to stop a script
# turning the results into whatever it wants. A shared laptop at a coaching
# clinic is the case this must not break, so the window is long and the count
# is not 1.
SUBMIT_LIMIT = 8
SUBMIT_WINDOW = 3600

# Guessing the results key should not be worth attempting.
KEY_ATTEMPTS = 10
KEY_WINDOW = 300


def results_key() -> str:
    """The passcode on the results link.

    QUESTIONNAIRE_RESULTS_KEY when set. Otherwise derived from the app's root
    secret, which is unique per deployment and never in the repository — so the
    link is protected out of the box rather than protected once somebody
    remembers to configure it. A default that works is a default that ships,
    and an unguarded page of strangers' names is not something to leave to a
    setup step.
    """
    return (os.environ.get("QUESTIONNAIRE_RESULTS_KEY") or "").strip() \
        or appsecrets.derive("questionnaire-results")[:32]


def require_results_access(request: Request, db: Session) -> None:
    """Let through a correct key, or a coach who is already signed in."""
    supplied = (request.query_params.get("key")
                or request.headers.get("x-questionnaire-key") or "").strip()
    if supplied:
        ratelimit.check(request, "questionnaire-key", limit=KEY_ATTEMPTS, window=KEY_WINDOW)
        # compare_digest rather than ==: a plain comparison stops at the first
        # wrong character, and how long it took is a hint about how much of the
        # key was right.
        if hmac.compare_digest(supplied, results_key()):
            return
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        from ..auth import coach_from_token
        if coach_from_token(auth.split(" ", 1)[1].strip(), db) is not None:
            return
    raise HTTPException(status_code=403, detail="This link needs its passcode.")


# ── Public ───────────────────────────────────────────────────────────────────

def _english_form() -> dict:
    return {
        "version": content.VERSION,
        "age_ranges": content.AGE_RANGES,
        "ui": content.UI_STRINGS,
        "roles": content.ROLES,
        "questions": {
            role: [
                {"text": q["text"], "multi": bool(q.get("multi")), "options": q["options"]}
                for q in qs
            ]
            for role, qs in content.QUESTIONS.items()
        },
    }


@router.get("/form")
async def get_form(lang: str | None = None, db: Session = Depends(get_db)):
    """The questions themselves. Public: this is what the form renders from.

    `lang` returns the same form in one of the app's languages. The shape is
    identical either way and the ORDER never changes, which is what lets a
    Spanish respondent's answers be stored as the same indexes as an English
    one's — the results count positions, not words, so the five roles can still
    be read side by side however each person answered.
    """
    form = _english_form()
    code = (lang or "en").strip().lower()
    if code in ("", "en") or code not in LANGUAGE_NAMES:
        return {**form, "language": "en"}

    cached = (db.query(models.QuestionnaireTranslation)
                .filter_by(version=content.VERSION, lang=code).first())
    if cached:
        return {**cached.payload, "language": code}

    translated = await _translate_form(form, code)
    if translated is None:
        # English rather than an error: a respondent who cannot read the form
        # is worse served by an empty page than by the original wording.
        return {**form, "language": "en", "translation_failed": True}

    try:
        db.add(models.QuestionnaireTranslation(
            version=content.VERSION, lang=code, payload=translated))
        db.commit()
    except Exception:
        # Two people opening the Spanish link at once both translate and one
        # loses the race on the unique index. Harmless — the form still gets
        # returned, and the next request reads the row the other one wrote.
        db.rollback()
    return {**translated, "language": code}


async def _translate_form(form: dict, code: str) -> dict | None:
    """Translate every string in the form in one call, keeping the structure.

    The model is given JSON and asked for JSON with identical keys and identical
    array lengths, because the arrays ARE the answer format: an option dropped
    or reordered in translation would silently record a Spanish respondent's
    answer as a different English one.
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    name = LANGUAGE_NAMES.get(code, code)
    payload = {
        "age_ranges": form["age_ranges"],
        "ui": form["ui"],
        "roles": [{"id": r["id"], "name": r["name"], "blurb": r["blurb"]} for r in form["roles"]],
        "questions": {
            role: [{"text": q["text"], "options": q["options"]} for q in qs]
            for role, qs in form["questions"].items()
        },
    }
    prompt = (
        f"Translate this basketball questionnaire into {name}.\n\n"
        "RULES:\n"
        "- Return ONLY JSON, in exactly the same shape as the input.\n"
        "- Keep every key, every array, and every array's LENGTH and ORDER identical. "
        "The positions are how answers are recorded; changing one changes what a "
        "person said.\n"
        "- Do not translate the \"id\" fields, and do not translate or remove the "
        "placeholders {n}, {total} and {name} — they are filled in with numbers "
        "and a person's name, and a translation that loses one leaves a gap on "
        "screen. Everything else is translated.\n"
        f"- Use the basketball vocabulary a native {name}-speaking coach actually uses.\n"
        "- Keep the tone plain and conversational. These are questions a person "
        "reads on their phone, not documentation.\n"
        "- Keep numbers and time spans as they are (\"30 to 40 minutes\" stays 30 to 40).\n\n"
        f"QUESTIONNAIRE:\n{json.dumps(payload, ensure_ascii=False)}"
    )
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        resp = await client.messages.create(
            model=SONNET, max_tokens=16000,
            messages=[{"role": "user", "content": prompt}],
        )
        blocks = [b for b in resp.content if hasattr(b, "text")]
        if not blocks:
            return None
        raw = blocks[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            raw = raw.split("\n", 1)[1] if raw.lower().startswith("json") else raw
        got = json.loads(raw)
    except Exception:
        log.exception("questionnaire: could not translate the form into %s", code)
        return None

    return _merge_translation(form, got)


def _merge_translation(form: dict, got: dict) -> dict | None:
    """Take the translated words, keep OUR structure.

    Anything the model got wrong about the shape falls back to English for that
    one string rather than failing the whole form or, worse, shifting an option
    into another one's position.
    """
    def pick(value, fallback):
        return value if isinstance(value, str) and value.strip() else fallback

    got_ui = got.get("ui") if isinstance(got.get("ui"), dict) else {}
    out_ui = {}
    for k, v in form["ui"].items():
        t = got_ui.get(k)
        # A translation that dropped a placeholder would render "of answered"
        # with the numbers missing, so it is refused in favour of the English.
        holders = [h for h in ("{n}", "{total}", "{name}") if h in v]
        ok = isinstance(t, str) and t.strip() and all(h in t for h in holders)
        out_ui[k] = t if ok else v

    ages = got.get("age_ranges")
    out_ages = [pick(ages[i] if isinstance(ages, list) and i < len(ages) else None, a)
                for i, a in enumerate(form["age_ranges"])]

    got_roles = got.get("roles") if isinstance(got.get("roles"), list) else []
    by_id = {r.get("id"): r for r in got_roles if isinstance(r, dict)}
    out_roles = [
        {"id": r["id"],
         "name": pick((by_id.get(r["id"]) or {}).get("name"), r["name"]),
         "blurb": pick((by_id.get(r["id"]) or {}).get("blurb"), r["blurb"])}
        for r in form["roles"]
    ]

    got_qs = got.get("questions") if isinstance(got.get("questions"), dict) else {}
    out_qs = {}
    for role, qs in form["questions"].items():
        theirs = got_qs.get(role) if isinstance(got_qs.get(role), list) else []
        rows = []
        for qi, q in enumerate(qs):
            t = theirs[qi] if qi < len(theirs) and isinstance(theirs[qi], dict) else {}
            t_opts = t.get("options") if isinstance(t.get("options"), list) else []
            rows.append({
                "text": pick(t.get("text"), q["text"]),
                "multi": q["multi"],
                # Zipped by position against OUR list, so the translated form
                # can never be longer, shorter or in a different order.
                "options": [pick(t_opts[oi] if oi < len(t_opts) else None, o)
                            for oi, o in enumerate(q["options"])],
            })
        out_qs[role] = rows

    return {"version": form["version"], "age_ranges": out_ages, "ui": out_ui,
            "roles": out_roles, "questions": out_qs}


class ResponseIn(BaseModel):
    role: str
    name: str
    email: str | None = None
    age_range: str | None = None
    # {"0": 2, "1": [0, 3]} — question index to the option index chosen. Keys
    # arrive as strings because that is what JSON gives; both are accepted.
    answers: dict[str, object] = Field(default_factory=dict)
    comment: str | None = None
    source: str | None = None


def _clean_answers(role: str, raw: dict) -> dict:
    """Keep only answers that name a real question and a real option.

    Validated rather than trusted. Everything here arrived from an unauthed
    POST, and an out-of-range index would be a summary counting an option that
    does not exist.
    """
    questions = content.questions_for(role)
    out: dict[str, object] = {}
    for key, value in (raw or {}).items():
        try:
            qi = int(key)
        except (TypeError, ValueError):
            continue
        if not (0 <= qi < len(questions)):
            continue
        n_opts = len(questions[qi]["options"])
        if questions[qi].get("multi"):
            if not isinstance(value, list):
                continue
            picked = sorted({v for v in value if isinstance(v, int) and 0 <= v < n_opts})
            if picked:
                out[str(qi)] = picked
        else:
            if isinstance(value, bool) or not isinstance(value, int):
                continue
            if 0 <= value < n_opts:
                out[str(qi)] = value
    return out


def _submitter_hash(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else (
        request.client.host if request.client else "unknown")
    return hashlib.sha256(f"bloomprint-questionnaire:{ip}".encode()).hexdigest()[:32]


@router.post("/responses")
def submit(
    body: ResponseIn,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Anyone can answer. No account, no email address, no login."""
    ratelimit.check(request, "questionnaire", limit=SUBMIT_LIMIT, window=SUBMIT_WINDOW)

    role = (body.role or "").strip()
    if role not in content.ROLE_IDS:
        raise HTTPException(status_code=400, detail="Pick which one you are first.")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Add your name so we know who answered.")

    age = (body.age_range or "").strip() or None
    if age and age not in content.AGE_RANGES:
        age = None

    # Kept only if it could be an address. Not verified — nobody is going to
    # click a confirmation link to answer seven questions — so a typo is stored
    # and found later, which is better than refusing the whole response over it.
    email = (body.email or "").strip().lower()[:MAX_EMAIL]
    if email and ("@" not in email or "." not in email.split("@")[-1] or " " in email):
        email = ""

    row = models.QuestionnaireResponse(
        version=content.VERSION,
        role=role,
        name=name[:MAX_NAME],
        email=email or None,
        age_range=age,
        answers=_clean_answers(role, body.answers),
        comment=((body.comment or "").strip()[:MAX_COMMENT] or None),
        submitter=_submitter_hash(request),
        source=((body.source or "").strip()[:MAX_SOURCE] or None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # After the commit, and in the background: mail is a side effect, and a
    # response that was saved must not come back as a failure because the mail
    # provider was down.
    background.add_task(_notify, row.id)
    return {"ok": True, "id": row.id}


# ── Results, for the coach who sent it out ───────────────────────────────────

def _row_out(row: models.QuestionnaireResponse) -> dict:
    answers = []
    questions = content.questions_for(row.role)
    for qi, q in enumerate(questions):
        picked = (row.answers or {}).get(str(qi))
        if isinstance(picked, list):
            chosen = [content.label(row.role, qi, i) for i in picked]
        elif isinstance(picked, int):
            chosen = content.label(row.role, qi, picked)
        else:
            chosen = None
        answers.append({"question": q["text"], "answer": chosen})
    return {
        "id": row.id,
        "role": row.role,
        "role_name": content.role_name(row.role),
        "name": row.name,
        "email": row.email,
        "age_range": row.age_range,
        "comment": row.comment,
        "source": row.source,
        "created_at": row.created_at,
        "answers": answers,
    }


@router.get("/responses")
def list_responses(
    request: Request,
    role: str | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    """Every response, newest first. Needs the key — these carry names."""
    require_results_access(request, db)
    q = db.query(models.QuestionnaireResponse)
    if role and role in content.ROLE_IDS:
        q = q.filter(models.QuestionnaireResponse.role == role)
    rows = q.order_by(models.QuestionnaireResponse.id.desc()).limit(max(1, min(limit, 500))).all()
    return [_row_out(r) for r in rows]


@router.get("/summary")
def summary(
    request: Request,
    db: Session = Depends(get_db),
):
    """Every option of every question, counted per role.

    Only responses on the current question version are counted. An older one is
    an answer to a differently-worded question, and adding the two together
    would be the quiet kind of wrong that never announces itself.
    """
    require_results_access(request, db)
    rows = (
        db.query(models.QuestionnaireResponse)
        .filter(models.QuestionnaireResponse.version == content.VERSION)
        .all()
    )
    by_role: dict[str, list] = {}
    totals: dict[str, int] = {}
    comments: list[dict] = []

    for role_id in content.ROLE_IDS:
        questions = content.questions_for(role_id)
        by_role[role_id] = [
            {"text": q["text"], "multi": bool(q.get("multi")),
             "options": [{"text": o, "count": 0} for o in q["options"]],
             "answered": 0}
            for q in questions
        ]
        totals[role_id] = 0

    for row in rows:
        if row.role not in by_role:
            continue
        totals[row.role] += 1
        block = by_role[row.role]
        for key, value in (row.answers or {}).items():
            try:
                qi = int(key)
            except (TypeError, ValueError):
                continue
            if not (0 <= qi < len(block)):
                continue
            picked = value if isinstance(value, list) else [value]
            counted = False
            for i in picked:
                if isinstance(i, int) and 0 <= i < len(block[qi]["options"]):
                    block[qi]["options"][i]["count"] += 1
                    counted = True
            if counted:
                block[qi]["answered"] += 1
        if row.comment:
            comments.append({"id": row.id, "name": row.name,
                             "role_name": content.role_name(row.role),
                             "comment": row.comment, "created_at": row.created_at})

    comments.sort(key=lambda c: c["id"], reverse=True)
    return {
        "version": content.VERSION,
        "total": sum(totals.values()),
        "roles": [
            {"id": r["id"], "name": r["name"], "count": totals[r["id"]],
             "questions": by_role[r["id"]]}
            for r in content.ROLES
        ],
        "comments": comments[:60],
    }


@router.get("/export")
def export_csv(
    request: Request,
    db: Session = Depends(get_db),
):
    """Every response as CSV rows, for cutting the results somewhere else.

    Returned as JSON holding the text rather than as a file download: the app
    is a single-page client and this lands in a copy button, which works the
    same on a phone browser as on a desktop.
    """
    import csv
    import io

    require_results_access(request, db)
    rows = (db.query(models.QuestionnaireResponse)
              .order_by(models.QuestionnaireResponse.id).all())
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "date", "role", "name", "email", "age_range", "source",
                *[f"q{i + 1}" for i in range(7)], "comment"])
    for r in rows:
        answers = []
        for qi in range(7):
            picked = (r.answers or {}).get(str(qi))
            if isinstance(picked, list):
                answers.append(" | ".join(
                    filter(None, (content.label(r.role, qi, i) for i in picked))))
            elif isinstance(picked, int):
                answers.append(content.label(r.role, qi, picked) or "")
            else:
                answers.append("")
        w.writerow([r.id, r.created_at.isoformat() if r.created_at else "",
                    content.role_name(r.role), r.name, r.email or "", r.age_range or "",
                    r.source or "", *answers, r.comment or ""])
    return {"csv": buf.getvalue(), "count": len(rows)}


# ── The email ────────────────────────────────────────────────────────────────

def questionnaire_to() -> str:
    """Where a new response is announced: the noreply mailbox.

    Deliberately the noreply address rather than FEEDBACK_TO. In-app feedback
    and a stranger's questionnaire answer are two different streams that want
    two different inboxes, and tying this to the feedback one would mean
    changing where bug reports go in order to change where responses go.

    QUESTIONNAIRE_TO overrides it.
    """
    return (os.environ.get("QUESTIONNAIRE_TO") or "").strip() or _address(mailer.mail_from())


def _address(value: str) -> str:
    """The bare address out of "BloomPrint <noreply@bloomprint.org>"."""
    if "<" in value and ">" in value:
        return value.split("<", 1)[1].split(">", 1)[0].strip()
    return value.strip()


def _notify_from() -> str:
    """The sender, kept different from the destination where possible.

    A message from noreply@ to noreply@ is a mailbox writing to itself, which
    some receiving servers treat as spoofing and drop — silently, which is the
    worst way to find out. FEEDBACK_FROM is used when it is set and different;
    otherwise this falls back to the normal sender, which works on a provider
    that signs for the domain and is the best available answer without asking
    for more configuration.
    """
    sender = (os.environ.get("FEEDBACK_FROM") or "").strip()
    if sender and _address(sender).lower() != questionnaire_to().lower():
        return sender
    return mailer.mail_from()


def _app_url() -> str:
    return (os.environ.get("APP_URL") or "https://bloomprint.org").rstrip("/")


def results_link() -> str:
    """The results URL with its key on it — what goes in every email."""
    return f"{_app_url()}/questionnaire/results?key={results_key()}"


def _notify(response_id: int) -> None:
    """Tell the owner a response came in, with the answers and a link.

    Its own session: this runs after the request has returned, and the session
    that saved the row is closed by then.
    """
    db = SessionLocal()
    try:
        row = db.get(models.QuestionnaireResponse, response_id)
        if row is None:
            return
        data = _row_out(row)
        lines = [
            f"{data['role_name']} — {data['name']}"
            + (f" ({data['age_range']})" if data["age_range"] else ""),
            data["email"] or "(no email — no invite can be sent to this one)",
            "",
        ]
        for i, a in enumerate(data["answers"], start=1):
            answer = a["answer"]
            if isinstance(answer, list):
                answer = "; ".join(x for x in answer if x)
            lines.append(f"{i}. {a['question']}")
            lines.append(f"   {answer or '(skipped)'}")
            lines.append("")
        if data["comment"]:
            lines.append("They added:")
            lines.append(f"   {data['comment']}")
            lines.append("")
        lines.append(f"All responses: {results_link()}")

        mailer.send_email(
            to=questionnaire_to(),
            subject=f"Questionnaire — {data['role_name']}, {data['name']}",
            text="\n".join(lines),
            from_addr=_notify_from(),
            # Hitting Reply reaches the person who answered, which is the whole
            # point of having asked them for an address.
            reply_to=data["email"] or None,
        )
    except Exception:
        # A notification that cannot be sent must not be able to take anything
        # else down; the response is already saved and readable on the results
        # page either way.
        log.exception("questionnaire: could not send the notification email")
    finally:
        db.close()
