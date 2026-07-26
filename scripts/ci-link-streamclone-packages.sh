#!/usr/bin/env bash
# RPR-6: no-op linker — packages live in-repo under packages/* (no sibling copy).
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
PACKAGES=(pulse-core analytics-console pulse-charts)

for pkg in "${PACKAGES[@]}"; do
  probe="${ROOT}/packages/${pkg}"
  if [[ ! -d "${probe}" ]]; then
    echo "ci-link-streampulse-packages: missing in-repo package ${probe}" >&2
    exit 1
  fi
done

echo "ci-link-streampulse-packages: no-op — using in-repo packages/* (RPR-6)"
