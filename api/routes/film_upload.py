"""Uploading a game film straight to storage, in pieces.

WHY NOT THROUGH THE API

A three-hour game is several gigabytes, and the old path sent all of it to this
server as one HTTP request, which then forwarded it to R2. That is one
connection that has to survive the entire upload — often the better part of an
hour on a home connection — and nothing about it can be resumed. A phone
changing wifi, a laptop sleeping, a proxy timing out, or the server being
replaced by a deploy all produce the same thing: "Upload failed — the
connection dropped", and an hour of uploading thrown away.

It also puts gigabytes through a web server that has no reason to see them.

WHAT HAPPENS INSTEAD

The browser asks for somewhere to put the film, gets a set of short-lived URLs,
and PUTs the file to storage in ~32 MB parts — each its own request, each
retried on its own. A dropped connection now costs one part, not the film. The
server never touches the bytes; it hands out signed URLs and, at the end, is
told which parts arrived.

This is the same mechanism every video service uses under the hood. There is
nothing to buy: R2 is S3-compatible and supports it natively.

CORS

The browser is PUTting to a different origin, so the bucket has to allow it.
`scripts/r2_cors.py` sets that policy with the credentials this server already
has — without it, every part fails in the browser with a CORS error and nothing
reaches storage.
"""
import os
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_coach
from ..database import get_db
from .. import models, storage

router = APIRouter(prefix="/film-upload", tags=["film-upload"])

# Big enough that a three-hour film is ~100 parts rather than thousands, small
# enough that losing one to a dropped connection costs seconds. (S3's own floor
# is 5 MB for any part but the last.)
PART_SIZE = 32 * 1024 * 1024

# A signed URL only has to live long enough to PUT one part on a slow line.
PART_URL_TTL = 6 * 3600


class StartIn(BaseModel):
    filename: str = "film.mp4"
    content_type: str = "video/mp4"
    # What the film is for, so the key says so when someone looks in the bucket.
    purpose: str = "film"


@router.get("/available")
def available(coach: models.Coach = Depends(get_current_coach)):
    """Can the browser upload straight to storage, or must it go through here?

    False on a local dev box with no bucket configured, where the old path is
    correct. The app asks rather than assuming, so one build works on both.
    """
    return {"direct": storage.use_s3(), "part_size": PART_SIZE}


@router.post("/start")
def start(body: StartIn, coach: models.Coach = Depends(get_current_coach)):
    """Open a multipart upload and say where it lives."""
    if not storage.use_s3():
        raise HTTPException(status_code=400, detail="Direct upload is not configured on this server.")
    suffix = os.path.splitext(body.filename or "")[1] or ".mp4"
    key = f"{body.purpose}_{coach.id}_{uuid4().hex}{suffix}"
    try:
        res = storage._client().create_multipart_upload(
            Bucket=os.environ["STORAGE_S3_BUCKET"], Key=key, ContentType=body.content_type,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not start the upload: {exc}")
    return {"key": key, "upload_id": res["UploadId"], "part_size": PART_SIZE}


class SignIn(BaseModel):
    key: str
    upload_id: str
    part_numbers: list[int]


@router.post("/sign")
def sign(body: SignIn, coach: models.Coach = Depends(get_current_coach)):
    """Signed PUT URLs for a batch of parts.

    Signed in batches rather than all at once so an upload of a hundred parts
    does not begin with a hundred signatures it may never use — and so a URL
    that expires mid-upload can simply be re-signed.
    """
    if not storage.use_s3():
        raise HTTPException(status_code=400, detail="Direct upload is not configured on this server.")
    _own_key_or_403(body.key, coach)
    bucket = os.environ["STORAGE_S3_BUCKET"]
    urls = []
    for n in body.part_numbers:
        urls.append({
            "part": n,
            "url": storage._client().generate_presigned_url(
                "upload_part",
                Params={"Bucket": bucket, "Key": body.key, "UploadId": body.upload_id, "PartNumber": n},
                ExpiresIn=PART_URL_TTL,
            ),
        })
    return {"urls": urls}


class Part(BaseModel):
    PartNumber: int
    ETag: str


class CompleteIn(BaseModel):
    key: str
    upload_id: str
    parts: list[Part]


@router.post("/complete")
def complete(body: CompleteIn, db: Session = Depends(get_db),
             coach: models.Coach = Depends(get_current_coach)):
    """Assemble the parts into the film, and hand back its storage ref."""
    if not storage.use_s3():
        raise HTTPException(status_code=400, detail="Direct upload is not configured on this server.")
    _own_key_or_403(body.key, coach)
    bucket = os.environ["STORAGE_S3_BUCKET"]
    try:
        storage._client().complete_multipart_upload(
            Bucket=bucket, Key=body.key, UploadId=body.upload_id,
            MultipartUpload={"Parts": [p.model_dump() for p in
                                       sorted(body.parts, key=lambda p: p.PartNumber)]},
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not finish the upload: {exc}")
    return {"ref": f"s3://{bucket}/{body.key}"}


class AbortIn(BaseModel):
    key: str
    upload_id: str


@router.post("/abort")
def abort(body: AbortIn, coach: models.Coach = Depends(get_current_coach)):
    """Give up on an upload, and stop paying for the parts already sent.

    An abandoned multipart upload keeps its parts in the bucket and bills for
    them while remaining invisible to a listing — the 1.93 GB of "empty" storage
    we chased once already.
    """
    if not storage.use_s3():
        return {"ok": True}
    _own_key_or_403(body.key, coach)
    try:
        storage._client().abort_multipart_upload(
            Bucket=os.environ["STORAGE_S3_BUCKET"], Key=body.key, UploadId=body.upload_id,
        )
    except Exception:
        pass
    return {"ok": True}


def _own_key_or_403(key: str, coach: models.Coach) -> None:
    """A key carries the coach who made it, so one coach cannot sign PUTs into
    another's film. The keys are unguessable, but that is not the same as being
    checked."""
    parts = (key or "").split("_")
    if len(parts) < 3 or parts[1] != str(coach.id):
        raise HTTPException(status_code=403, detail="That upload does not belong to you.")
