#!/usr/bin/env bash
# Retired by RPR-6 — packages live in-repo under packages/*.
# Do not clone streampulse-backend for CI package resolution.
set -euo pipefail
echo "ci-checkout-pulse-packages: refused — RPR-6 uses in-repo packages/*; run scripts/ci-verify-pulse-packages.sh" >&2
exit 1
