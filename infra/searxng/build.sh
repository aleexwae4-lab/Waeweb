#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM="$ROOT/upstream"
PIN="3cd69d30e2a78dfc817be9e349e7c2e4317c92e3"

python -m pip install --upgrade pip setuptools wheel pyyaml msgspec typing-extensions pybind11
rm -rf "$UPSTREAM"
git clone --filter=blob:none --no-checkout https://github.com/searxng/searxng.git "$UPSTREAM"
git -C "$UPSTREAM" fetch --depth=1 origin "$PIN"
git -C "$UPSTREAM" checkout --detach "$PIN"
python -m pip install --use-pep517 --no-build-isolation -e "$UPSTREAM"
python -m pip install "granian>=2.5,<3"

actual="$(git -C "$UPSTREAM" rev-parse HEAD)"
test "$actual" = "$PIN"
python - <<'PY'
import searx
from searx import webapp
assert webapp.app is not None
print("WAE_SEARCH_CORE_BUILD_OK")
PY
