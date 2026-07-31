"""Speech to text, in one place, for every feature that listens.

Deepgram over HTTP, with local Whisper kept as a fallback.

WHY THIS EXISTS

Transcription used to be `whisper.load_model(...)` written out in two places,
each loading a multi-gigabyte model onto the Mac's GPU. That works exactly as
long as the app runs on that Mac. It is not slow-in-production, it is
doesn't-run-in-production: a server without MPS, without torch, and without the
RAM to hold the weights cannot transcribe at all. Deepgram makes speech to text
a network call, which is the same call from anywhere.

THE RETURN SHAPE

`transcribe_file` returns Whisper's result dict — `{"text", "segments",
"language"}`, segments being `{"start", "end", "text"}` — because the callers
already format and slice that shape. Matching it means the provider swap is
invisible above this module, and it means the Whisper fallback and the Deepgram
path are genuinely interchangeable rather than merely similar.

FALLBACK

If DEEPGRAM_API_KEY is set, Deepgram is used. If it isn't, and Whisper happens
to be installed, Whisper runs — so a laptop with no key keeps working. If
neither is available the caller gets a clear error naming what to configure,
rather than an ImportError about torch.

Env:
  DEEPGRAM_API_KEY   enables Deepgram (preferred)
  DEEPGRAM_MODEL     override the model (default nova-3)
  WHISPER_MODEL      size for the local fallback only (default small)
"""
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger(__name__)

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"

# Words a general-purpose model gets wrong in basketball and a coach then has to
# fix by hand. Sent as key terms so they're recognised rather than guessed at:
# "pick and roll" is otherwise "pick and role", and a coach saying "iso" gets
# "I so". Costs nothing per request and only affects English.
BASKETBALL_TERMS = [
    "pick and roll", "pick and pop", "isolation", "iso", "post up", "box out",
    "close out", "help side", "weak side", "strong side", "drop coverage",
    "hedge", "ice", "switch", "zone", "man to man", "full court press",
    "fast break", "transition", "half court", "paint", "elbow", "wing",
    "corner three", "top of the key", "baseline", "inbound", "BLOB", "SLOB",
    "high ball screen", "dribble handoff", "backdoor cut", "give and go",
    "offensive rebound", "defensive rebound", "turnover", "assist", "steal",
    "block", "and one", "free throw", "layup", "floater", "step back",
    "euro step", "triple threat", "rotation", "spacing", "tempo",
]

_MIME = {
    ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".mp3": "audio/mpeg",
    ".wav": "audio/wav", ".webm": "audio/webm", ".ogg": "audio/ogg",
    ".flac": "audio/flac", ".aac": "audio/aac", ".caf": "audio/x-caf",
    ".mov": "video/quicktime", ".mkv": "video/x-matroska",
}


class SpeechUnavailable(RuntimeError):
    """No transcription provider is configured or reachable."""


def deepgram_enabled() -> bool:
    return bool(os.environ.get("DEEPGRAM_API_KEY"))


def _whisper_installed() -> bool:
    import importlib.util
    return importlib.util.find_spec("whisper") is not None


def provider() -> str | None:
    """Which backend a transcription would use right now, or None."""
    if deepgram_enabled():
        return "deepgram"
    if _whisper_installed():
        return "whisper"
    return None


def available() -> bool:
    return provider() is not None


# ── Deepgram ──────────────────────────────────────────────────────────────────

def _deepgram_params(language: str | None, keyterms: list[str] | None) -> list[tuple[str, str]]:
    model = os.environ.get("DEEPGRAM_MODEL") or "nova-3"
    params: list[tuple[str, str]] = [
        ("model", model),
        # Punctuation and capitalisation. A coach reads this text and edits it;
        # an unpunctuated wall is worse than a slightly wrong comma.
        ("smart_format", "true"),
        # Utterance-level chunks, which is what gives us start/end segments. The
        # callers timestamp film against these, so without it the transcript
        # can't be lined up with what's on screen.
        ("utterances", "true"),
    ]
    if language:
        params.append(("language", language))
    else:
        # The app ships in 25 languages; assuming English silently mistranscribes
        # every coach who doesn't speak it.
        params.append(("detect_language", "true"))

    # Key terms are nova-3 + English only. Sending them otherwise is rejected.
    if keyterms and model.startswith("nova-3") and (language or "en").startswith("en"):
        for term in keyterms:
            params.append(("keyterm", term))
    return params


# What Deepgram accepted for a given requested language, remembered after the
# first successful call. Dictation sends a 2.5-second chunk at a time, so paying
# the discovery cost on every chunk would triple the latency of every word.
_STRATEGY_CACHE: dict[str, tuple[str | None, bool]] = {}


def _strategies(language: str | None) -> list[tuple[str | None, bool]]:
    """Ways to ask for `language`, best first, as (language_param, send_keyterms).

    The transcription model covers a subset of the 25 languages this app ships
    in, and that subset keeps growing. Rather than hardcode a list — a guess
    today and stale in a month — ask for what we want and step down when it's
    refused, remembering what worked. New language support starts working on its
    own; unsupported ones still transcribe.
    """
    if not language:
        return [(None, True), (None, False)]
    return [
        # What the coach actually set the app to.
        (language, True),
        # Multilingual codeswitching — covers the widely-spoken languages even
        # when the specific code isn't accepted on its own.
        ("multi", False),
        # Let the model work it out from the audio. Last because a couple of
        # seconds of speech is thin evidence.
        (None, False),
    ]


def _deepgram_result(payload: dict) -> dict:
    """Map Deepgram's response onto Whisper's result shape."""
    results = payload.get("results") or {}
    channels = results.get("channels") or [{}]
    alt = ((channels[0].get("alternatives") or [{}])[0]) if channels else {}

    segments = [
        {
            "start": float(u.get("start") or 0.0),
            "end": float(u.get("end") or 0.0),
            "text": (u.get("transcript") or "").strip(),
        }
        for u in (results.get("utterances") or [])
        if (u.get("transcript") or "").strip()
    ]

    text = (alt.get("transcript") or "").strip()
    if not text and segments:
        # utterances came back but the flat transcript didn't; rebuild it rather
        # than reporting silence for audio we demonstrably transcribed.
        text = " ".join(s["text"] for s in segments)

    return {
        "text": text,
        "segments": segments,
        "language": channels[0].get("detected_language") or "unknown",
    }


def _deepgram_post(body: bytes, content_type: str, language: str | None,
                   keyterms: list[str] | None, timeout: float) -> dict:
    url = f"{DEEPGRAM_URL}?{urllib.parse.urlencode(_deepgram_params(language, keyterms))}"
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}",
            "Content-Type": content_type,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return _deepgram_result(json.loads(resp.read().decode("utf-8")))


def _transcribe_deepgram(path: str, language: str | None,
                         keyterms: list[str] | None, timeout: float) -> dict:
    ext = os.path.splitext(path)[1].lower()
    with open(path, "rb") as f:
        body = f.read()
    if not body:
        return {"text": "", "segments": [], "language": "unknown"}
    content_type = _MIME.get(ext, "application/octet-stream")

    cache_key = language or ""
    known = _STRATEGY_CACHE.get(cache_key)
    attempts = [known] if known else _strategies(language)

    last_detail = ""
    last_code = 0
    for lang_param, use_keyterms in attempts:
        try:
            result = _deepgram_post(
                body, content_type, lang_param,
                keyterms if use_keyterms else None, timeout,
            )
        except urllib.error.HTTPError as exc:
            last_code, last_detail = exc.code, exc.read().decode("utf-8", "replace")[:300]
            # 400 means it won't accept these options — worth trying a different
            # way of asking. 401 (bad key) or 5xx won't change with the params,
            # so stop rather than hammering the API three times over.
            if exc.code != 400:
                break
            log.warning(
                "Deepgram refused language=%r keyterms=%s (%s): %s",
                lang_param, use_keyterms, exc.code, last_detail,
            )
            if known:
                # The remembered strategy stopped working; rediscover it.
                _STRATEGY_CACHE.pop(cache_key, None)
                return _transcribe_deepgram(path, language, keyterms, timeout)
            continue
        if not known and (lang_param, use_keyterms) != (language, True):
            log.info(
                "Deepgram: %r not accepted directly, using language=%r for this language",
                language, lang_param,
            )
        _STRATEGY_CACHE[cache_key] = (lang_param, use_keyterms)
        return result

    raise SpeechUnavailable(
        f"Deepgram rejected the request ({last_code}): {last_detail}"
    )


# ── Local Whisper (fallback only) ─────────────────────────────────────────────

_whisper_model = None
_whisper_size = None


def _load_whisper():
    global _whisper_model, _whisper_size
    size = os.environ.get("WHISPER_MODEL", "small")
    if _whisper_model is not None and _whisper_size == size:
        return _whisper_model
    import whisper  # type: ignore[import]
    try:
        import torch  # type: ignore[import]
        device = "mps" if torch.backends.mps.is_available() else "cpu"
    except Exception:
        device = "cpu"
    last_err = None
    for candidate in [size, "small", "base"]:
        try:
            _whisper_model = whisper.load_model(candidate, device=device)
            _whisper_size = size
            return _whisper_model
        except Exception as e:  # noqa: PERF203 - each size is a separate attempt
            last_err = e
    raise SpeechUnavailable(f"Could not load a local Whisper model: {last_err}")


def _transcribe_whisper(path: str, language: str | None, prompt: str | None) -> dict:
    import whisper  # type: ignore[import]
    model = _load_whisper()
    options: dict = {
        "fp16": False,
        "beam_size": 1,
        "best_of": 1,
        "condition_on_previous_text": True,
        # If a decode looks low-confidence, retry hotter instead of dropping words.
        "temperature": (0.0, 0.2, 0.4, 0.6),
        "no_speech_threshold": 0.5,
        "logprob_threshold": -1.0,
        "compression_ratio_threshold": 2.4,
    }
    if language:
        options["language"] = language
    if prompt:
        # The running speech context, which already carries the domain words the
        # speaker just used. Deliberately NOT a static comma-list vocabulary:
        # on short chunks its compression ratio trips Whisper's hallucination
        # guard and returns nothing, which then starves the context and breaks
        # every following chunk.
        options["initial_prompt"] = prompt
    result = whisper.transcribe(model, path, **options)
    return {
        "text": (result.get("text") or "").strip(),
        "segments": result.get("segments") or [],
        "language": result.get("language") or "unknown",
    }


# ── Public entry point ────────────────────────────────────────────────────────

def transcribe_file(path: str, *, language: str | None = None,
                    prompt: str | None = None, keyterms: list[str] | None = None,
                    timeout: float = 300.0) -> dict:
    """Transcribe an audio or video file. Returns Whisper's result shape.

    `language` is a hint; leave it None to auto-detect, which is right for an
    app used in 25 languages. `prompt` only helps the Whisper fallback (Deepgram
    has no equivalent); `keyterms` only helps Deepgram. Passing both is fine —
    each backend uses what applies to it and ignores the rest.

    Raises SpeechUnavailable when nothing is configured, so the caller can turn
    that into a 503 the user can act on.
    """
    which = provider()
    if which == "deepgram":
        return _transcribe_deepgram(path, language, keyterms, timeout)
    if which == "whisper":
        return _transcribe_whisper(path, language, prompt)
    raise SpeechUnavailable(
        "Speech to text is not configured. Set DEEPGRAM_API_KEY on the server."
    )
