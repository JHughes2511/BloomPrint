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


# ── Letting the browser upload straight here ────────────────────────────────
#
# Film goes to the bucket from the coach's browser, in parts (see
# routes/film_upload.py). That is a cross-origin PUT, so the bucket has to name
# the sites allowed to make one — and until it does, every part fails in the
# browser with a CORS error while the server logs stay clean, because the server
# never sees the request. It is the kind of configuration that is invisible
# right up to the moment it is the only thing wrong, so the app sets it itself
# at boot rather than leaving it to a step someone has to remember.

# The same origins the API already trusts to call it. One list: an origin
# allowed to use the app is exactly the origin allowed to upload film for it.
def web_origins() -> list[str]:
    configured = [o.strip() for o in os.environ.get("BLOOMPRINT_CORS_ORIGINS", "").split(",") if o.strip()]
    # Development, where the API's own CORS uses a regex the bucket cannot
    # express — so the ports a dev server actually picks are listed instead.
    dev = [f"http://localhost:{p}" for p in (8081, 19006, 8412, 3000)]
    dev += [f"http://127.0.0.1:{p}" for p in (8081, 19006, 8412, 3000)]
    return configured + dev


def desired_cors(origins: list[str] | None = None) -> dict:
    return {
        "CORSRules": [
            {
                "AllowedOrigins": origins or web_origins(),
                "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
                "AllowedHeaders": ["*"],
                # A multipart upload is assembled from the ETag of each part,
                # and a browser cannot read a header the bucket has not exposed.
                # Without this every part uploads fine and the upload can never
                # be completed.
                "ExposeHeaders": ["ETag"],
                "MaxAgeSeconds": 3600,
            }
        ]
    }


def cors_is_current(existing: list[dict] | None, want: dict) -> bool:
    """Does the bucket already allow what we need? Compared rather than assumed,
    so boot does not write a policy that is already there."""
    rule = want["CORSRules"][0]
    for got in existing or []:
        if (set(rule["AllowedOrigins"]) <= set(got.get("AllowedOrigins") or [])
                and set(rule["AllowedMethods"]) <= set(got.get("AllowedMethods") or [])
                and "ETag" in (got.get("ExposeHeaders") or [])):
            return True
    return False


def cors_allows(existing: list[dict] | None, origin: str | None) -> bool:
    """Would the bucket accept an upload from THIS origin?

    The question that actually matters, and a narrower one than "does the policy
    match the one we would write". A policy set by hand in the Cloudflare
    dashboard will list the production origins and nothing else — entirely
    correct, and not equal to ours. Judging it by equality would report browser
    uploads as unavailable while the bucket was perfectly willing.
    """
    if not origin:
        return False
    for got in existing or []:
        origins = got.get("AllowedOrigins") or []
        methods = {m.upper() for m in (got.get("AllowedMethods") or [])}
        if ((origin in origins or "*" in origins)
                and "PUT" in methods
                and "ETag" in (got.get("ExposeHeaders") or [])):
            return True
    return False


# Whether the bucket really accepts browser uploads. Cached because it is asked
# on the upload path, and re-checked periodically so granting the permission
# later starts working without a restart.
_cors_ok: dict = {"at": 0.0, "value": False, "origin": None}


def browser_uploads_allowed(origin: str | None = None) -> bool:
    """Is a direct browser upload actually going to work?

    Not the same question as "is a bucket configured". The bucket also has to
    allow the app's origin, and if the token cannot set that policy — which is
    what happens when the R2 key lacks PutBucketCors — then every part would
    fail in the browser with a CORS error and the coach would watch an upload
    die for a reason nothing reports. Better to answer honestly and let the app
    use the path that works.
    """
    import time

    if not use_s3():
        return False
    now = time.time()
    key = origin or ""
    if now - _cors_ok["at"] < 300 and _cors_ok.get("origin") == key:
        return _cors_ok["value"]
    try:
        existing = _client().get_bucket_cors(Bucket=_BUCKET).get("CORSRules")
        # Either the policy we would write, or any policy that happens to allow
        # the origin actually asking. The second is what a hand-written rule in
        # the Cloudflare dashboard looks like.
        ok = cors_allows(existing, origin) or cors_is_current(existing, desired_cors())
    except Exception:
        ok = False
    _cors_ok.update({"at": now, "value": ok, "origin": key})
    return ok


def ensure_bucket_cors() -> str:
    """Make sure the bucket accepts uploads from the app. Never raises.

    Returns a short word on what happened, for the boot log: nothing here may
    stop the API from starting, and a bucket that refuses to be configured is a
    thing to report, not to crash on.
    """
    if not use_s3():
        return "skipped (no bucket configured)"
    want = desired_cors()
    configured = [o.strip() for o in os.environ.get("BLOOMPRINT_CORS_ORIGINS", "").split(",") if o.strip()]
    try:
        client = _client()
        try:
            existing = client.get_bucket_cors(Bucket=_BUCKET).get("CORSRules")
        except Exception:
            existing = None
        # Already fine if it matches what we would write, OR if it simply allows
        # every origin this app is served from. The second is what a policy set
        # by hand in the Cloudflare dashboard looks like, and reporting that as
        # a failure — then trying to overwrite it — would be both wrong and rude.
        by_hand = bool(configured) and all(cors_allows(existing, o) for o in configured)
        if cors_is_current(existing, want) or by_hand:
            _cors_ok.update({"at": __import__("time").time(), "value": True, "origin": None})
            return ("already allows browser uploads"
                    + (" (policy set outside this app — leaving it alone)" if by_hand
                       and not cors_is_current(existing, want) else ""))
        client.put_bucket_cors(Bucket=_BUCKET, CORSConfiguration=want)
        _cors_ok.update({"at": __import__("time").time(), "value": True})
        return f"updated to allow {len(want['CORSRules'][0]['AllowedOrigins'])} origin(s)"
    except Exception as exc:
        try:
            rules = _client().get_bucket_cors(Bucket=_BUCKET).get("CORSRules") or []
        except Exception:
            rules = []
        # Which origins the bucket WILL take an upload from, whoever set the
        # policy. Reported instead of a bare failure: not being allowed to
        # change a policy says nothing about whether the policy is right, and a
        # correct bucket should not be described as broken.
        ready = sorted({o for r in rules for o in (r.get("AllowedOrigins") or [])
                        if cors_allows(rules, o)})
        if ready:
            return ("cannot change the bucket's policy (no permission), but it already "
                    f"accepts uploads from: {', '.join(ready)}")
        if not rules:
            why = "the bucket has no CORS policy"
        else:
            why = "no origin in the bucket's policy allows PUT with ETag exposed"
        return (f"NOT READY — {why}, and this server cannot set it ({exc}). "
                "Film uploads the old way until that is fixed.")


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
