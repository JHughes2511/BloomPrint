"""Read an upload without letting it decide how much memory the server uses.

Every document endpoint did `content = await file.read()`, which buffers the
whole upload before anything can object to its size. Checking `len(content)`
afterwards is too late — the memory is already gone, and a handful of
concurrent multi-gigabyte POSTs is all it takes to end the process. The check
has to happen while reading, which means reading in chunks.

Film doesn't go through here: video is streamed to storage by api/storage.py
and never held in memory, so it's bounded by disk rather than RAM.
"""
from fastapi import HTTPException, UploadFile

# Documents, spreadsheets, and photographed notes. Comfortably above any real
# roster or box score, far below what threatens the process.
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

_CHUNK = 1024 * 1024


async def read_upload(file: UploadFile, max_bytes: int = MAX_DOCUMENT_BYTES,
                      what: str = "file") -> bytes:
    """Return the upload's bytes, or 413 as soon as it exceeds `max_bytes`.

    Stops at the first chunk that crosses the limit, so an oversized upload
    costs `max_bytes` plus one chunk rather than however much the client felt
    like sending.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"That {what} is too large. The limit is "
                       f"{max_bytes // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)
