#!/usr/bin/env bash
# CI: sparse-checkout pulse packages into ./_streampulse-backend/packages.
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
DEST="${ROOT}/_streampulse-backend"
PACKAGES=(pulse-core analytics-console pulse-charts)
FALLBACK_REF="${PULSE_PACKAGES_FALLBACK_REF:-v0.3.0-rc27}"

sparse_clone() {
  local repo="$1"
  local ref="$2"
  local token="${3:-}"

  rm -rf "${DEST}"
  mkdir -p "${ROOT}"

  local auth_url="https://github.com/${repo}.git"
  if [[ -n "${token}" ]]; then
    auth_url="https://x-access-token:${token}@github.com/${repo}.git"
  fi

  git -C "${ROOT}" clone --depth 1 --branch "${ref}" --filter=blob:none --sparse "${auth_url}" "${DEST}"
  git -C "${DEST}" sparse-checkout set \
    packages/pulse-core \
    packages/analytics-console \
    packages/pulse-charts
}

if [[ -n "${STREAMPULSE_BACKEND_CHECKOUT_TOKEN:-}" ]]; then
  echo "ci-checkout-pulse-packages: using streampulse-backend@master"
  sparse_clone "Aron-Chu/streampulse-backend" "master" "${STREAMPULSE_BACKEND_CHECKOUT_TOKEN}"
else
  echo "ci-checkout-pulse-packages: no PAT — using streamclone@${FALLBACK_REF} packages"
  sparse_clone "Aron-Chu/streamclone" "${FALLBACK_REF}"
fi

for pkg in "${PACKAGES[@]}"; do
  probe="${DEST}/packages/${pkg}"
  if [[ ! -d "${probe}" ]]; then
    echo "ci-checkout-pulse-packages: missing ${probe}" >&2
    exit 1
  fi
done

echo "ci-checkout-pulse-packages: ok"
