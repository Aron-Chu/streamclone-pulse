#!/usr/bin/env bash
# Back-compat wrapper — prefer ci-link-streamclone-packages.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/scripts/ci-link-streamclone-packages.sh"
