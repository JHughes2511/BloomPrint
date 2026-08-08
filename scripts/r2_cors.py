"""Allow the app's own origins to PUT film straight into the bucket.

The browser now uploads a game film to R2 itself, in parts (see
api/routes/film_upload.py). That is a cross-origin request, so the bucket has to
say which sites may make one — without this every part fails in the browser with
a CORS error and nothing reaches storage, while the server logs stay clean
because the server never sees the request.

ExposeHeaders matters as much as the origins: a multipart upload is assembled
from the ETag of each part, and a browser cannot read a response header the
bucket has not exposed.

Run:
    python scripts/r2_cors.py            # show the policy that is set
    python scripts/r2_cors.py --apply    # set it

Uses the same credentials the server does (STORAGE_S3_BUCKET, AWS_*,
S3_ENDPOINT_URL), so it needs no Cloudflare dashboard access.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import storage  # noqa: E402

ORIGINS = [
    "https://bloomprint.org",
    "https://www.bloomprint.org",
    # Cloudflare Pages builds every branch at its own subdomain.
    "https://bloomprint.pages.dev",
    # Local development.
    "http://localhost:8081",
    "http://localhost:19006",
    "http://127.0.0.1:8412",
]

POLICY = {
    "CORSRules": [
        {
            "AllowedOrigins": ORIGINS,
            "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
            "AllowedHeaders": ["*"],
            # Without ETag exposed, the browser uploads every part successfully
            # and then cannot tell the server what it sent.
            "ExposeHeaders": ["ETag"],
            "MaxAgeSeconds": 3600,
        }
    ]
}


def main() -> None:
    bucket = os.environ.get("STORAGE_S3_BUCKET")
    if not bucket:
        raise SystemExit("STORAGE_S3_BUCKET is not set — nothing to configure.")
    client = storage._client()

    if "--apply" in sys.argv:
        client.put_bucket_cors(Bucket=bucket, CORSConfiguration=POLICY)
        print(f"Applied to {bucket}:")
    else:
        print(f"Current policy on {bucket} (run with --apply to set the one below):")
    try:
        current = client.get_bucket_cors(Bucket=bucket)
        print(json.dumps(current.get("CORSRules"), indent=2))
    except Exception as exc:
        print(f"  (none set — {exc})")
    if "--apply" not in sys.argv:
        print("\nWould apply:")
        print(json.dumps(POLICY["CORSRules"], indent=2))


if __name__ == "__main__":
    main()
