import os
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException

router = APIRouter(prefix="/transcribe", tags=["transcribe"])


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
        import whisper
        model = whisper.load_model("base")
        result = model.transcribe(tmp_path)
        text = (result.get("text") or "").strip()
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
