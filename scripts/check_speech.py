#!/usr/bin/env python3
"""Report how speech to text is configured, and which languages it accepts.

    python3 scripts/check_speech.py            # every language the app ships in
    python3 scripts/check_speech.py fr ka zh   # just these

Run it from the repo root, after `source .env` (or with DEEPGRAM_API_KEY
exported). It sends a short silent clip per language and reports whether the
request was ACCEPTED, not what came back — an empty transcript from silence is
a pass. The point is to find languages the provider refuses outright, which is
what makes dictation produce nothing at all.
"""
import os
import struct
import sys
import tempfile
import wave

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import speech  # noqa: E402

# The 25 the app ships in, matching mobile/src/i18n/languages.ts.
APP_LANGUAGES = [
    "en", "es", "fr", "de", "it", "pt", "nl", "sv", "pl", "ro", "el", "tr",
    "ru", "uk", "sr", "hr", "lt", "ka", "zh", "ja", "ko", "hi", "tl", "ar", "he",
]


def silent_wav(seconds: float = 1.0, rate: int = 16000) -> str:
    """A valid, well-formed clip that happens to contain no speech."""
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<h", 0) * int(rate * seconds))
    return path


def main() -> int:
    which = speech.provider()
    print(f"provider        : {which or 'NONE — dictation will 503'}")
    print(f"DEEPGRAM_API_KEY: {'set' if speech.deepgram_enabled() else 'NOT SET'}")
    print(f"DEEPGRAM_MODEL  : {os.environ.get('DEEPGRAM_MODEL') or 'nova-3 (default)'}")
    if not which:
        print("\nSet DEEPGRAM_API_KEY in .env, then re-run.")
        return 1
    if which != "deepgram":
        print("\nUsing local Whisper. Language support is broad; nothing to check here.")
        return 0

    wanted = [a.lower() for a in sys.argv[1:]] or APP_LANGUAGES
    clip = silent_wav()
    print(f"\nTesting {len(wanted)} language(s) with a 1s silent clip:\n")
    direct, degraded, failed = [], [], []
    try:
        for code in wanted:
            speech._STRATEGY_CACHE.clear()   # measure each language honestly
            try:
                speech.transcribe_file(clip, language=code,
                                       keyterms=speech.BASKETBALL_TERMS, timeout=30.0)
            except speech.SpeechUnavailable as exc:
                failed.append(code)
                print(f"  {code:3s}  FAILED    {str(exc)[:90]}")
                continue
            used = speech._STRATEGY_CACHE.get(code, (None, False))[0]
            if used == code:
                direct.append(code)
                print(f"  {code:3s}  ok        native support")
            else:
                degraded.append(code)
                print(f"  {code:3s}  ok        via language={used!r} (not supported directly)")
    finally:
        os.unlink(clip)

    print(f"\n{len(direct)} native, {len(degraded)} via fallback, {len(failed)} failing")
    if failed:
        print("Failing languages produce no dictation at all — send this output on.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
