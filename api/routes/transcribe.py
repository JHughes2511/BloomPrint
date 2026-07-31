"""Speech to text for the app's dictation buttons.

Thin by design: everything about *how* audio becomes text lives in api/speech.py,
so this endpoint is only responsible for getting the upload onto disk, bounding
its size, and turning a missing provider into a status code the client can show.
"""
import os
import tempfile
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from .. import speech

router = APIRouter(prefix="/transcribe", tags=["transcribe"])

# A dictation chunk is seconds of speech. Anything approaching this is either a
# bug in the client or someone using the endpoint for something else; either way
# the upload is read into memory, so it needs a ceiling.
MAX_AUDIO_BYTES = 25 * 1024 * 1024


@router.post("")
async def transcribe_audio(
    audio: UploadFile = File(...),
    context: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
):
    """Transcribe one chunk of dictated speech.

    `language` is optional and defaults to auto-detect. It used to be pinned to
    English, which quietly mistranscribed every coach using one of the other 24
    languages the app ships in.
    """
    suffix = ".m4a"
    if audio.filename:
        ext = os.path.splitext(audio.filename)[1]
        if ext:
            suffix = ext

    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="No audio received.")
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="That recording is too long to transcribe.")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = speech.transcribe_file(
            tmp_path,
            language=language,
            # Helps the Whisper fallback only; Deepgram has no prompt equivalent.
            prompt=context,
            keyterms=speech.BASKETBALL_TERMS,
            # Short chunks — fail fast rather than leaving the mic button spinning.
            timeout=60.0,
        )
        return {"text": result.get("text", ""), "language": result.get("language")}
    except speech.SpeechUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
