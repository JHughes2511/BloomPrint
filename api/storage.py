"""Durable file storage for uploaded media (film).

S3-compatible object storage when configured, local disk otherwise (dev). A
stored file is referenced by an opaque string ("ref"):
  - S3:   "s3://<bucket>/<key>"
  - local: an absolute/relative filesystem path under ./uploads

Configure S3 (works with AWS S3, Cloudflare R2, MinIO, etc.) via env:
  STORAGE_S3_BUCKET      (enables S3 when set)
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
  S3_ENDPOINT_URL        (optional — for R2/MinIO/custom endpoints)
"""
import os
import shutil
import tempfile
from pathlib import Path

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

_BUCKET = os.environ.get("STORAGE_S3_BUCKET")


def use_s3() -> bool:
    return bool(_BUCKET)


def _client():
    import boto3  # imported lazily so local dev needs no boto3
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
        region_name=os.environ.get("AWS_REGION") or None,
    )


def _parse(ref: str):
    rest = ref[len("s3://"):]
    bucket, _, key = rest.partition("/")
    return bucket, key


class StorageFullError(Exception):
    """Raised when a local write fails because the disk is out of space."""


def save_fileobj(fileobj, key: str) -> str:
    """Persist a file-like object under `key`; returns its storage ref."""
    if use_s3():
        _client().upload_fileobj(fileobj, _BUCKET, key)
        return f"s3://{_BUCKET}/{key}"
    dest = UPLOAD_DIR / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with dest.open("wb") as f:
            shutil.copyfileobj(fileobj, f)
    except OSError as exc:
        # Don't leave a half-written file behind (it still consumes space).
        try:
            dest.unlink(missing_ok=True)
        except Exception:
            pass
        import errno
        if getattr(exc, "errno", None) == errno.ENOSPC:
            raise StorageFullError("No space left on device") from exc
        raise
    return str(dest)


def ref_for(key: str) -> str:
    """The storage ref a given key would have (without uploading)."""
    return f"s3://{_BUCKET}/{key}" if use_s3() else str(UPLOAD_DIR / key)


def exists(ref: str) -> bool:
    if not ref:
        return False
    if ref.startswith("s3://"):
        b, k = _parse(ref)
        try:
            _client().head_object(Bucket=b, Key=k)
            return True
        except Exception:
            return False
    return os.path.exists(ref)


def ensure_local(ref: str) -> str:
    """A readable local path (downloads from S3 to a temp file if needed).
    Used before frame extraction / transcription, which need a real file."""
    if ref and ref.startswith("s3://"):
        b, k = _parse(ref)
        suffix = os.path.splitext(k)[1] or ".mp4"
        fd, tmp = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        _client().download_file(b, k, tmp)
        return tmp
    return ref


def playback_url(ref: str, stream_fallback: str) -> str:
    """A URL the client can play: a presigned GET for S3, else the backend
    stream path passed in."""
    if ref and ref.startswith("s3://"):
        b, k = _parse(ref)
        try:
            return _client().generate_presigned_url(
                "get_object", Params={"Bucket": b, "Key": k}, ExpiresIn=6 * 3600
            )
        except Exception:
            return stream_fallback
    return stream_fallback


def delete(ref: str):
    try:
        if ref and ref.startswith("s3://"):
            b, k = _parse(ref)
            _client().delete_object(Bucket=b, Key=k)
        elif ref and os.path.exists(ref):
            os.remove(ref)
    except Exception:
        pass
