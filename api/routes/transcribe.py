import os
import tempfile
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional

router = APIRouter(prefix="/transcribe", tags=["transcribe"])

_whisper_model = None
_device = None

# Primes Whisper toward basketball vocabulary so domain jargon (P&R, closeout,
# box out, and-one, etc.) transcribes correctly — used to seed the first chunk
# before there's any prior-speech context to lean on.
_DOMAIN_PROMPT = (
    "Basketball film and game notes. Common terms: pick and roll, P&R, ball screen, "
    "closeout, box out, and-one, pull-up, floater, transition, help defense, rotation, "
    "deflection, offensive rebound, defensive rebound, assist, turnover, steal, block, "
    "drop coverage, hedge, switch, isolation, post up, catch and shoot, mid-range, "
    "three-pointer, free throw, layup, dunk, wing, corner, elbow, paint."
)


def _get_model():
    global _whisper_model, _device
    if _whisper_model is None:
        import torch
        import whisper
        _device = "mps" if torch.backends.mps.is_available() else "cpu"
        # Prefer a more accurate model; fall back to lighter ones if it can't
        # load (limited RAM/VRAM). Override with WHISPER_MODEL; on a GPU use
        # "large-v3-turbo" (near-large accuracy, much faster) for best results.
        configured = os.environ.get("WHISPER_MODEL", "medium")
        candidates = [configured, "small", "base"]
        seen = set()
        last_err = None
        for size in candidates:
            if size in seen:
                continue
            seen.add(size)
            try:
                _whisper_model = whisper.load_model(size, device=_device)
                break
            except Exception as e:
                last_err = e
        if _whisper_model is None:
            raise RuntimeError(f"Failed to load Whisper model: {last_err}")
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
        # Bias toward basketball vocabulary. Use the running speech context when
        # we have it (it already carries the domain words the user just said),
        # otherwise seed with the domain prompt so the very first chunk is primed.
        options["initial_prompt"] = context if context else _DOMAIN_PROMPT
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
