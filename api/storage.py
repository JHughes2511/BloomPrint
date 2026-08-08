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
import logging
import os
import shutil
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

_BUCKET = os.environ.get("STORAGE_S3_BUCKET")


def use_s3() -> bool:
    return bool(_BUCKET)


def _client():
    import boto3  # imported lazily so local dev needs no boto3
    from botocore.config import Config

    endpoint = os.environ.get("S3_ENDPOINT_URL") or None
    # A custom endpoint means R2, MinIO or similar, and those want "auto".
    # Without a region boto3 quietly falls back to SigV2 — a presigned URL of
    # the form ?AWSAccessKeyId=..&Signature=..&Expires=.. — and R2 does not
    # accept SigV2 at all, so every upload and every playback URL is refused.
    # Nothing in the app reports that as a configuration problem: it surfaces as
    # film that will not upload or will not play.
    region = os.environ.get("AWS_REGION") or ("auto" if endpoint else None)
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        # Stated rather than inferred. The signature version is the difference
        # between a URL R2 honours and one it rejects, and it should not depend
        # on which environment variables happen to be present.
        config=Config(signature_version="s3v4"),
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


# Downloaded film, kept where a second attempt can find it.
FILM_CACHE = Path(tempfile.gettempdir()) / "bloomprint-film"


def _cache_path(ref: str) -> Path:
    import hashlib

    b, k = _parse(ref)
    suffix = os.path.splitext(k)[1] or ".mp4"
    return FILM_CACHE / (hashlib.sha1(ref.encode()).hexdigest() + suffix)


def ensure_local(ref: str) -> str:
    """A readable local path (downloads from S3 when needed).

    Two things this must not do on a three-hour film, both of which it used to.

    It must not leave the download behind. A game film is gigabytes, the old
    path wrote each one to a fresh mkstemp file and nothing ever deleted it, so
    every attempt at the same film added another copy to the container's disk.
    A few resumes of one long film is enough to fill it, and a full disk kills
    the process — which orphans the job, which triggers a resume, which
    downloads it again.

    And it must not re-download what is already here. A resumed analysis skips
    the segments it finished; making it re-fetch several gigabytes first throws
    that saving away. The copy is keyed by ref and reused when it is complete —
    verified against the object's size, because a download interrupted by the
    very restart we are recovering from would otherwise be reused as though it
    were the film.
    """
    if not (ref and ref.startswith("s3://")):
        return ref

    b, k = _parse(ref)
    dest = _cache_path(ref)
    dest.parent.mkdir(parents=True, exist_ok=True)

    want = None
    try:
        want = _client().head_object(Bucket=b, Key=k).get("ContentLength")
    except Exception:
        pass

    if dest.exists() and (want is None or dest.stat().st_size == want):
        log.info("Film already on disk, reusing %s", dest)
        return str(dest)

    # Downloaded beside the target and moved into place, so a half-finished
    # download is never mistaken for the film.
    part = dest.with_suffix(dest.suffix + ".part")
    _client().download_file(b, k, str(part))
    os.replace(part, dest)
    return str(dest)


def release_local(ref: str) -> None:
    """Drop the downloaded copy of a film. Call when a job is finished with it —
    not when it is merely interrupted, since the next attempt wants it."""
    if not (ref and ref.startswith("s3://")):
        return
    try:
        p = _cache_path(ref)
        if p.exists():
            size = p.stat().st_size
            p.unlink()
            log.info("Released %s MB of downloaded film", round(size / 1e6))
    except Exception:
        pass


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


def delete(ref: str) -> bool:
    """Remove a stored file. Returns whether it is now gone.

    A failure here is not cosmetic: film is the only thing in this app measured
    in gigabytes, and a delete that quietly does nothing bills the coach for
    storage they believe they released. Swallowing the exception hid exactly
    that — the app reported success whatever the bucket did. It is still never
    raised (a delete that fails must not fail the request that asked for it),
    but it is logged, and the caller can see it.
    """
    if not ref:
        return True
    try:
        if ref.startswith("s3://"):
            b, k = _parse(ref)
            _client().delete_object(Bucket=b, Key=k)
        elif os.path.exists(ref):
            os.remove(ref)
        return True
    except Exception as exc:
        log.warning("Could not delete stored file %s: %s", ref, exc)
        return False
