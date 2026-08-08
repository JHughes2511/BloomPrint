"""Inspect (or force) the bucket policy that lets the browser upload film.

The app sets this itself at boot — see storage.ensure_bucket_cors, and the
"Film upload (browser → storage): …" line in the startup log. This script is
for looking at what is actually set, or for applying it without waiting for a
restart. It calls the same code the app does, so the two cannot drift apart.

    python scripts/r2_cors.py            # what is set, and what we would set
    python scripts/r2_cors.py --apply    # set it now

Uses the credentials the server already has (STORAGE_S3_BUCKET, AWS_*,
S3_ENDPOINT_URL) — no Cloudflare dashboard access needed.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import storage  # noqa: E402


def main() -> None:
    bucket = os.environ.get("STORAGE_S3_BUCKET")
    if not bucket:
        raise SystemExit("STORAGE_S3_BUCKET is not set — this server stores film on local disk.")

    try:
        current = storage._client().get_bucket_cors(Bucket=bucket).get("CORSRules")
    except Exception as exc:
        current = None
        print(f"No policy set on {bucket} ({exc})\n")

    if current:
        print(f"Set on {bucket}:")
        print(json.dumps(current, indent=2))
        print()

    want = storage.desired_cors()
    if storage.cors_is_current(current, want):
        print("This already allows the app to upload film. Nothing to do.")
        if "--apply" not in sys.argv:
            return

    if "--apply" in sys.argv:
        print("Applying:", storage.ensure_bucket_cors())
    else:
        print("Would apply (or let the app apply it on its next restart):")
        print(json.dumps(want["CORSRules"], indent=2))


if __name__ == "__main__":
    main()
