#!/usr/bin/env bash
# Block production topology leaks in the public streamclone-pulse repo.
# Scans staged content with the same rules as CI (scripts/ci-public-topology-scan.sh).
# Operators enable the exact private deny-list locally by exporting
# STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN or STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN_FILE
# from private streampulse-ops; never commit those values here.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
exec bash "${ROOT}/scripts/ci-public-topology-scan.sh" --cached
