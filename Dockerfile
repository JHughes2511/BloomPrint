# Production image for the BloomPrint API.
#
# This repo holds two apps — api/ (FastAPI) and mobile/ (Expo) — so a platform
# pointed at the root has to guess which one to build, and guesses wrong. A
# Dockerfile removes the guess: what installs, what runs, and on which Python
# are stated here rather than inferred from whatever files happen to be present.
#
# Build context stays the repo root, not api/, because the app is imported as
# the package path `api.main:app` and requirements.txt lives at the root.

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# ffmpeg is a runtime dependency, not a build tool: video_vision/server.py
# shells out to it to sample frames and strip the audio track off uploaded
# film. Missing, film analysis fails with an error that reads like a code bug.
# libgl1 and libglib are what opencv links against even in the headless build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies in their own layer, ahead of the source, so a code-only push
# reuses the cached install instead of recompiling everything each deploy.
COPY requirements.txt ./

# requirements.txt is deliberately the lean API set. Three groups are added on
# top of it here because this image, unlike a laptop, has to serve every route:
#
#   psycopg      — the Postgres driver. It lives in the `postgres` extra in
#                  pyproject.toml, so a requirements-only install builds fine
#                  and then dies at startup the moment DATABASE_URL is a
#                  Postgres URL. Installed unconditionally; it costs nothing
#                  when the app is on SQLite.
#   opencv/numpy/Pillow — imported at module scope by video_vision/server.py,
#                  which the film-analysis routes load lazily.
#   mcp          — same module, same reason.
RUN pip install --no-cache-dir -r requirements.txt \
      "psycopg[binary]>=3.1" \
      "opencv-python-headless>=4.8.0" \
      "numpy>=1.24.0" \
      "Pillow>=10.0.0" \
      "mcp>=1.0.0"

# Only the two Python packages. mobile/ is a separate app and would add a
# node_modules tree to an image that has no use for it.
COPY api ./api
COPY video_vision ./video_vision

# Uploaded film lands here when object storage isn't configured. It is created
# at import time by api/storage.py, so it has to be writable by the run user —
# and owned before the drop to non-root, not after.
RUN mkdir -p /app/uploads \
 && useradd --create-home --uid 10001 bloom \
 && chown -R bloom:bloom /app
USER bloom

# The port is assigned by the platform at run time, so it cannot be baked in.
# Binding a fixed 8000 is the classic "deploy succeeded, every request 502s"
# failure: the app is healthy and simply not listening where the proxy looks.
# No --reload: it runs a file watcher and a second process, which in production
# is wasted memory and a restart loop waiting to happen.
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
