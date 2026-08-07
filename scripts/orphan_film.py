#!/usr/bin/env python3
"""Find film sitting in storage that the app no longer references.

Deleting a packet or an evaluation used to free nothing, so a bucket that has
been in use for a while holds film nothing can reach any more. This lists what
is there, subtracts everything the database still points at, and reports the
difference with sizes.

It REPORTS by default and deletes nothing. Read the list first — it is your
film, and there is no undo.

    python -m scripts.orphan_film                 # what is orphaned, and how big
    python -m scripts.orphan_film --delete        # remove those objects
    python -m scripts.orphan_film --delete --yes  # no confirmation prompt

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


def referenced_keys(db) -> set[str]:
    """Every storage key the database still points at.

    Soft-deleted rows are included on purpose: a hidden evaluation is meant to
    be recoverable, so its film is not an orphan.
    """
    keys: set[str] = set()
    for model in (models.Evaluation, models.PlayerVideo, models.GameReportClip):
        q = db.query(model.video_path).execution_options(include_deleted=True)
        for (ref,) in q.all():
            if not ref:
                continue
            keys.add(ref.split("/", 3)[3] if ref.startswith("s3://") else ref)
    return keys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--delete", action="store_true", help="actually remove the orphans")
    ap.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    args = ap.parse_args()

    if not storage.use_s3():
        print("STORAGE_S3_BUCKET is not set — nothing to scan.")
        return 1

    bucket = os.environ["STORAGE_S3_BUCKET"]
    client = storage._client()

    db = SessionLocal()
    try:
        keep = referenced_keys(db)
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

    orphan_bytes = sum(s for _, s in orphans)
    print(f"bucket {bucket}")
    print(f"  objects        : {total_objects}  ({human(total_bytes)})")
    print(f"  referenced     : {total_objects - len(orphans)}")
    print(f"  ORPHANED       : {len(orphans)}  ({human(orphan_bytes)})")
    if not orphans:
        print("\nNothing to clean up.")
        return 0

    print()
    for key, size in sorted(orphans, key=lambda kv: -kv[1]):
        print(f"  {human(size).rjust(9)}  {key}")

    if not args.delete:
        print(f"\nReport only. Re-run with --delete to free {human(orphan_bytes)}.")
        return 0

    if not args.yes:
        answer = input(f"\nDelete {len(orphans)} objects ({human(orphan_bytes)})? Type 'delete' to confirm: ")
        if answer.strip().lower() != "delete":
            print("Nothing deleted.")
            return 0

    removed = 0
    for key, _ in orphans:
        if storage.delete(f"s3://{bucket}/{key}"):
            removed += 1
    print(f"\nDeleted {removed} of {len(orphans)} objects — {human(orphan_bytes)} freed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
