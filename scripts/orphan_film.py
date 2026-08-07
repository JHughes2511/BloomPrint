#!/usr/bin/env python3
"""Find storage the app is paying for and no longer needs.

Two kinds of waste, and one of them is invisible.

ORPHANED OBJECTS are film the database no longer points at — deleting a packet
or an evaluation used to free nothing, so a bucket in use for a while holds
film nothing can reach.

UNFINISHED UPLOADS are worse, because the dashboard does not show them at all.
A large file goes up in parts, and the object only appears once the last part
lands. Interrupt it — a dropped connection, a closed tab, a deploy restarting
the server mid-upload — and the parts stay, billed as stored bytes, with
nothing in the object list to explain the number. A bucket reading "1.93 GB"
over an empty listing is this.

It REPORTS by default and deletes nothing. Read the list first — it is your
film, and there is no undo.

    python scripts/orphan_film.py                    # what is wasted, and how much
    python scripts/orphan_film.py --delete           # reclaim it
    python scripts/orphan_film.py --include-deleted  # count film behind deleted reports too

Needs the same environment as the server: DATABASE_URL, STORAGE_S3_BUCKET,
S3_ENDPOINT_URL and the AWS keys. Run it against production only when you mean
to — it reads that bucket and that database.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import models, storage           # noqa: E402
from api.database import SessionLocal     # noqa: E402


def human(n: int) -> str:
    gb = n / 1024 ** 3
    if gb >= 1:
        return f"{gb:.2f} GB"
    return f"{n / 1024 ** 2:.0f} MB"


def referenced_keys(db, include_deleted: bool = True) -> set[str]:
    """Every storage key the database still points at.

    Soft-deleted rows count by default: a hidden evaluation is meant to be
    recoverable, so its film is not an orphan. Pass include_deleted=False to
    treat film behind deleted reports as reclaimable too — that is film from
    before deleting a report released it, and it is not coming back.
    """
    keys: set[str] = set()
    for model in (models.Evaluation, models.PlayerVideo, models.GameReportClip):
        q = db.query(model.video_path)
        if include_deleted:
            q = q.execution_options(include_deleted=True)
        for (ref,) in q.all():
            if not ref:
                continue
            keys.add(ref.split("/", 3)[3] if ref.startswith("s3://") else ref)
    return keys


def incomplete_uploads(client, bucket: str) -> list[tuple[str, str, int]]:
    """Multipart uploads that were started and never finished.

    These are why a bucket can bill for gigabytes while showing an empty object
    list: the parts exist and count toward stored bytes, but no object does
    until the upload completes. A film upload that was interrupted — a dropped
    connection, a closed tab, a container restart mid-deploy — leaves them, and
    nothing ever cleans them up on its own.

    Returns (key, upload_id, bytes) per abandoned upload.
    """
    out: list[tuple[str, str, int]] = []
    kwargs: dict = {"Bucket": bucket}
    while True:
        page = client.list_multipart_uploads(**kwargs)
        for up in page.get("Uploads", []) or []:
            size = 0
            try:
                parts = client.list_parts(Bucket=bucket, Key=up["Key"], UploadId=up["UploadId"])
                size = sum(p.get("Size", 0) for p in parts.get("Parts", []) or [])
            except Exception:
                pass
            out.append((up["Key"], up["UploadId"], size))
        if not page.get("IsTruncated"):
            break
        kwargs["KeyMarker"] = page.get("NextKeyMarker")
        kwargs["UploadIdMarker"] = page.get("NextUploadIdMarker")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--delete", action="store_true", help="actually remove the orphans")
    ap.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    ap.add_argument("--include-deleted", action="store_true",
                    help="also treat film belonging to DELETED packets/evals as orphaned "
                         "(they are kept by default so a deleted report stays recoverable)")
    ap.add_argument("--set-lifecycle", type=int, metavar="DAYS", nargs="?", const=7,
                    help="tell the bucket to abort unfinished uploads itself after DAYS "
                         "(default 7), so they stop accumulating")
    args = ap.parse_args()

    if not storage.use_s3():
        print("STORAGE_S3_BUCKET is not set — nothing to scan.")
        return 1

    bucket = os.environ["STORAGE_S3_BUCKET"]
    client = storage._client()

    if args.set_lifecycle:
        # Prevention, not cleanup: without a rule, an interrupted upload's parts
        # sit in the bucket forever and no one ever sees them.
        days = args.set_lifecycle
        try:
            client.put_bucket_lifecycle_configuration(
                Bucket=bucket,
                LifecycleConfiguration={"Rules": [{
                    "ID": "abort-unfinished-film-uploads",
                    "Status": "Enabled",
                    "Filter": {"Prefix": ""},
                    "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": days},
                }]},
            )
            print(f"Lifecycle rule set: unfinished uploads are aborted after {days} days.\n")
        except Exception as exc:
            print(f"Could not set the lifecycle rule: {exc}\n")

    db = SessionLocal()
    try:
        keep = referenced_keys(db, include_deleted=not args.include_deleted)
    finally:
        db.close()

    orphans: list[tuple[str, int]] = []
    total_objects = 0
    total_bytes = 0
    token = None
    while True:
        kw = {"Bucket": bucket, "MaxKeys": 1000}
        if token:
            kw["ContinuationToken"] = token
        page = client.list_objects_v2(**kw)
        for obj in page.get("Contents", []):
            total_objects += 1
            total_bytes += obj["Size"]
            if obj["Key"] not in keep:
                orphans.append((obj["Key"], obj["Size"]))
        if not page.get("IsTruncated"):
            break
        token = page.get("NextContinuationToken")

    try:
        stuck = incomplete_uploads(client, bucket)
    except Exception as exc:
        stuck = []
        print(f"(could not list multipart uploads: {exc})")

    orphan_bytes = sum(s for _, s in orphans)
    stuck_bytes = sum(s for _, _, s in stuck)
    print(f"bucket {bucket}")
    print(f"  objects            : {total_objects}  ({human(total_bytes)})")
    print(f"  referenced         : {total_objects - len(orphans)}")
    print(f"  ORPHANED objects   : {len(orphans)}  ({human(orphan_bytes)})")
    print(f"  UNFINISHED uploads : {len(stuck)}  ({human(stuck_bytes)})")
    if not args.include_deleted:
        print("  (film behind deleted reports is kept — re-run with --include-deleted to reclaim it)")

    if orphans:
        print("\n  orphaned objects:")
        for key, size in sorted(orphans, key=lambda kv: -kv[1]):
            print(f"    {human(size).rjust(9)}  {key}")
    if stuck:
        print("\n  unfinished uploads (invisible in the dashboard, still billed):")
        for key, _uid, size in sorted(stuck, key=lambda kv: -kv[2]):
            print(f"    {human(size).rjust(9)}  {key}")

    total_free = orphan_bytes + stuck_bytes
    if not orphans and not stuck:
        print("\nNothing to clean up.")
        return 0

    if not args.delete:
        print(f"\nReport only. Re-run with --delete to free {human(total_free)}.")
        return 0

    if not args.yes:
        answer = input(f"\nRemove {len(orphans)} objects and {len(stuck)} unfinished uploads "
                       f"({human(total_free)})? Type 'delete' to confirm: ")
        if answer.strip().lower() != "delete":
            print("Nothing deleted.")
            return 0

    removed = 0
    for key, _ in orphans:
        if storage.delete(f"s3://{bucket}/{key}"):
            removed += 1
    aborted = 0
    for key, upload_id, _ in stuck:
        try:
            client.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
            aborted += 1
        except Exception as exc:
            print(f"  could not abort {key}: {exc}")
    print(f"\nDeleted {removed} of {len(orphans)} objects, "
          f"aborted {aborted} of {len(stuck)} unfinished uploads — {human(total_free)} freed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
