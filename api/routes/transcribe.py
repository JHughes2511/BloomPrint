import os
import tempfile
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional

router = APIRouter(prefix="/transcribe", tags=["transcribe"])

_whisper_model = None
_device = None


def _get_model():
    global _whisper_model, _device
    if _whisper_model is None:
        try:
            import torch
            import whisper
            if torch.backends.mps.is_available():
                _device = "mps"
            else:
                _device = "cpu"
            model_size = os.environ.get("WHISPER_MODEL", "small")
            _whisper_model = whisper.load_model(model_size, device=_device)
        except Exception as e:
            raise RuntimeError(f"Failed to load Whisper model: {e}")
    return _whisper_model


@router.post("")
async def transcribe_audio(
    audio: UploadFile = File(...),
    context: Optional[str] = Form(None),
):
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
        options = dict(
            language="en",
            fp16=(_device == "mps"),
            beam_size=1,
            best_of=1,
            condition_on_previous_text=True,
            # Temperature fallback: if a decode looks low-confidence,
            # Whisper retries at a higher temperature instead of dropping words.
            temperature=(0.0, 0.2, 0.4, 0.6),
            # Hallucination / dropped-word guards tuned for short chunks.
            no_speech_threshold=0.5,
            logprob_threshold=-1.0,
            compression_ratio_threshold=2.4,
        )
        if context:
            options["initial_prompt"] = context
        result = model.transcribe(tmp_path, **options)
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
