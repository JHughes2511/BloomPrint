"""BloomPrint FastAPI backend."""

import os

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routes import auth, players, evaluations, training, uploads, teams, player_auth, player_routes, game_reports, staff_sharing, game_eval, transcribe, team_staff, staff_messages, imports, assistant, translations, feedback, search, unsubscribe, join, film_upload, preferences, questionnaire, exports, decide

app = FastAPI(title="BloomPrint API", version="1.0.0")

# CORS is a browser control, and the mobile app isn't a browser — it is
# unaffected either way. What the wildcard did do was let any web page a coach
# had open call this API with their session. Note that allow_origins=["*"] with
# allow_credentials=True is rejected by browsers anyway, so the old config was
# both unsafe in intent and broken in practice.
#
# The web build IS a browser, so CORS now decides whether the app can talk to
# its own API at all. Set BLOOMPRINT_CORS_ORIGINS (comma-separated) to the
# deployed web origin in production.
_origins = [o.strip() for o in os.environ.get("BLOOMPRINT_CORS_ORIGINS", "").split(",") if o.strip()]

# Local development is allowed on any port, by regex rather than by listing
# guesses: `expo start --web` picks a free port, and an allowlist that misses it
# fails as an opaque CORS error rather than a clear one. This grants nothing to
# a remote attacker — a page they serve is on their origin, not localhost.
_LOCAL_ORIGINS = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=_LOCAL_ORIGINS,
    # Tokens travel in the Authorization header, not cookies, so credentialed
    # requests aren't needed. Leaving this off keeps the browser from ever
    # attaching cookies cross-origin if session cookies are added later.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(players.router)
app.include_router(evaluations.router)
app.include_router(training.router)
app.include_router(uploads.router)
app.include_router(imports.router)
app.include_router(assistant.router)
app.include_router(teams.router)
app.include_router(player_auth.router)
app.include_router(player_routes.router)
app.include_router(game_reports.router)
app.include_router(staff_sharing.router)
app.include_router(game_eval.router)
app.include_router(transcribe.router)
app.include_router(team_staff.router)
app.include_router(staff_messages.router)
app.include_router(translations.router)
app.include_router(feedback.router)
app.include_router(unsubscribe.router)
app.include_router(search.router)
app.include_router(preferences.router)
app.include_router(film_upload.router)
app.include_router(questionnaire.router)
app.include_router(exports.router)
app.include_router(join.router)
app.include_router(join.link_router)
app.include_router(decide.router)


@app.on_event("startup")
def on_startup():
    init_db()
    # Whether mail can go out at all, stated once at boot. Every send is
    # fire-and-forget by design, so a missing provider is otherwise invisible
    # until someone notices an email that never arrived — and by then the
    # question "is it configured?" is the hard one to answer.
    import logging

    from .mailer import mail_enabled, mail_from

    log = logging.getLogger(__name__)
    if mail_enabled():
        provider = "Resend" if os.environ.get("RESEND_API_KEY") else "SMTP"
        log.info("Email enabled via %s, sending as %s", provider, mail_from())
    else:
        log.warning(
            "Email is NOT configured — no signup, share or invite mail will be "
            "sent. Set RESEND_API_KEY (or SMTP_HOST) to turn it on."
        )

    # A gap in the email copy is invisible at runtime: an untranslated event
    # silently falls back to English and nothing looks broken, which is exactly
    # why it has to be checked by something that looks on purpose. Logged, not
    # raised — a missing translation is not a reason to refuse to serve.
    from .emails import check_complete, check_notif_copy

    for problem in check_complete() + check_notif_copy():
        log.warning("Email copy: %s", problem)

    # Comments and replies queue instead of mailing one at a time, and there is
    # no scheduler in this app to send the batches, so the flusher is a thread
    # this process owns. See api/digest.py.
    from . import digest

    digest.start()

    # Film uploads go from the coach's browser straight to the bucket, which
    # only works if the bucket allows that origin. Stated at boot for the same
    # reason as the mail line above: it is invisible until it is the only thing
    # wrong, and then it looks like a broken upload rather than a setting.
    from .storage import ensure_bucket_cors

    _cors = ensure_bucket_cors()
    # Warned rather than noted when it fails, because INFO is filtered out of
    # most production logs and this is the difference between film uploading
    # and film silently not uploading.
    if _cors.startswith("COULD NOT SET"):
        log.warning("Film upload (browser → storage): %s", _cors)
    else:
        log.info("Film upload (browser → storage): %s", _cors)


@app.get("/health")
def health():
    return {"status": "ok", "service": "BloomPrint API"}


def start():
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    start()
