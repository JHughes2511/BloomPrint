"""Speech to text for the app's dictation buttons.

Thin by design: everything about *how* audio becomes text lives in api/speech.py,
so this endpoint is only responsible for getting the upload onto disk, bounding
its size, and turning a missing provider into a status code the client can show.
"""
import os
import tempfile
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError

from .. import speech
from ..appsecrets import coach_key, player_key
from ..uploadguard import read_upload

router = APIRouter(prefix="/transcribe", tags=["transcribe"])

_bearer = OAuth2PasswordBearer(tokenUrl="/auth/login")


def require_any_user(token: str = Depends(_bearer)) -> str:
    """Accept a signed-in coach or player, and nobody else.

    This endpoint was open to anyone who could reach the server. That was
    already wrong, and became expensive when transcription moved to a metered
    API — an unauthenticated POST loop is a bill.

    Both audiences need dictation, so either token is fine; no database lookup
    is needed because nothing here is scoped to a user. A valid signature is
    the whole question being asked.
    """
    for key in (coach_key(), player_key()):
        try:
            jwt.decode(token, key, algorithms=["HS256"])
            return token
        except JWTError:
            continue
    raise HTTPException(
        status_code=401,
        detail="Sign in to use voice input.",
        headers={"WWW-Authenticate": "Bearer"},
    )

# A dictation chunk is seconds of speech. Anything approaching this is either a
# bug in the client or someone using the endpoint for something else; either way
# the upload is read into memory, so it needs a ceiling.
MAX_AUDIO_BYTES = 25 * 1024 * 1024


@router.post("")
async def transcribe_audio(
    audio: UploadFile = File(...),
    context: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    _user: str = Depends(require_any_user),
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

    content = await read_upload(audio, MAX_AUDIO_BYTES, what="recording")
    if not content:
        raise HTTPException(status_code=400, detail="No audio received.")

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
