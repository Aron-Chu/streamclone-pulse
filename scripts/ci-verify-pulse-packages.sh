#!/usr/bin/env bash
# RPR-6: verify in-repo packages exist (no private streampulse-backend checkout).
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
PACKAGES=(pulse-core analytics-console pulse-charts)

for pkg in "${PACKAGES[@]}"; do
  probe="${ROOT}/packages/${pkg}"
  if [[ ! -d "${probe}" ]]; then
    echo "ci-verify-pulse-packages: missing in-repo package ${probe}" >&2
    exit 1
  fi
  if [[ ! -f "${probe}/package.json" ]]; then
    echo "ci-verify-pulse-packages: missing ${probe}/package.json" >&2
    exit 1
  fi
  if [[ ! -f "${probe}/LICENSE" ]]; then
    echo "ci-verify-pulse-packages: missing ${probe}/LICENSE" >&2
    exit 1
  fi
  if [[ ! -f "${probe}/NOTICE" ]]; then
    echo "ci-verify-pulse-packages: missing ${probe}/NOTICE (NOTICE is mandatory)" >&2
    exit 1
  fi
done

echo "ci-verify-pulse-packages: in-repo packages ok (RPR-6; private backend checkout retired)"
# Owner action (not automated): remove retired STREAMPULSE_BACKEND_CHECKOUT_TOKEN secret.
