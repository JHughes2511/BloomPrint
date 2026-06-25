import os
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException

router = APIRouter(prefix="/transcribe", tags=["transcribe"])

_whisper_model = None


def _get_model():
    global _whisper_model
    if _whisper_model is None:
        try:
            import whisper
            _whisper_model = whisper.load_model("base")
        except Exception as e:
            raise RuntimeError(f"Failed to load Whisper model: {e}")
    return _whisper_model


@router.post("")
async def transcribe_audio(audio: UploadFile = File(...)):
    suffix = ".m4a"
    if audio.filename:
        ext = os.path.splitext(audio.filename)[1]
        if ext:
            suffix = ext

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await audio.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        model = _get_model()
        result = model.transcribe(tmp_path)
        text = (result.get("text") or "").strip()
        return {"text": text}
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
