#!/usr/bin/env bash
# Xteink & Kindle EPUB Converter — easy launcher (Linux / macOS)
# Creates a virtual environment, installs dependencies, starts the web app.
set -e
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"

if [ ! -d .venv ]; then
    echo "Creating virtual environment (.venv)..."
    "$PYTHON" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "Installing dependencies..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

PORT="${PORT:-5000}"
echo ""
echo "Starting EPUB converter at http://localhost:${PORT}"
echo "Press Ctrl+C to stop."
echo ""
exec python app.py
