#!/usr/bin/env bash
# DEPRECATED for authoritative CI — workflow checks out packages via actions/checkout
# at scripts/ci-pulse-packages.pin. This script now fails closed instead of using a
# stale public streamclone package fallback.
set -euo pipefail

echo "ci-checkout-pulse-packages: refused — use actions/checkout + scripts/ci-verify-pulse-packages.sh" >&2
echo "ci-checkout-pulse-packages: authoritative CI must not silently fall back to public package snapshots" >&2
exit 1
