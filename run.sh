#!/usr/bin/env bash
# BloomPrint API — one-command run. Creates a local venv (once), installs deps
# (once), and starts the FastAPI server with reload. Insulated from whatever
# `python3` Homebrew happens to point at.
#
#   ./run.sh                 # start the API on :8000
#   PYTHON=python3.13 ./run.sh   # pin a specific interpreter for the venv
set -euo pipefail
cd "$(dirname "$0")"

# Prefer a stable interpreter for the venv; override with PYTHON=...
if [ -n "${PYTHON:-}" ]; then PY="$PYTHON"
else
  for c in python3.13 python3.12 python3.11 python3; do
    if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
  done
fi
: "${PY:?No python3 found on PATH}"

if [ ! -d .venv ]; then
  echo "→ creating venv with $PY"
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip >/dev/null

if ! python -c "import uvicorn, fastapi, sqlalchemy" >/dev/null 2>&1; then
  echo "→ installing dependencies (first run — this can take a minute)"
  # Full project (incl. video/whisper). If the heavy video deps fail to build on
  # a brand-new Python, fall back to the API-only requirements so the server runs.
  pip install -e . || pip install -r requirements.txt
fi

echo "→ starting API on http://0.0.0.0:8000"
exec uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
