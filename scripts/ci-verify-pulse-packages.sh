#!/usr/bin/env bash
# Verify authoritative pulse packages were checked out at the pinned SHA.
# Does not clone — the workflow uses actions/checkout with persist-credentials: false.
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
DEST="${ROOT}/_streampulse-backend"
PIN_FILE="${ROOT}/scripts/ci-pulse-packages.pin"
PACKAGES=(pulse-core analytics-console pulse-charts)

if [[ ! -f "${PIN_FILE}" ]]; then
  echo "ci-verify-pulse-packages: missing pin file ${PIN_FILE}" >&2
  exit 1
fi

EXPECTED="$(grep -E '^[0-9a-f]{40}$' "${PIN_FILE}" | head -n1 || true)"
if [[ -z "${EXPECTED}" ]]; then
  echo "ci-verify-pulse-packages: pin file must contain a 40-char lowercase SHA line" >&2
  exit 1
fi

if [[ ! -d "${DEST}/.git" && ! -f "${DEST}/.git" && ! -d "${DEST}" ]]; then
  echo "ci-verify-pulse-packages: missing checkout at ${DEST}" >&2
  exit 1
fi

ACTUAL="$(git -C "${DEST}" rev-parse HEAD)"
echo "ci-verify-pulse-packages: resolved_commit=${ACTUAL}"
if [[ "${ACTUAL}" != "${EXPECTED}" ]]; then
  echo "ci-verify-pulse-packages: checkout ${ACTUAL} != pin ${EXPECTED}" >&2
  exit 1
fi

for pkg in "${PACKAGES[@]}"; do
  probe="${DEST}/packages/${pkg}"
  if [[ ! -d "${probe}" ]]; then
    echo "ci-verify-pulse-packages: missing ${probe}" >&2
    exit 1
  fi
done

# Record resolved SHA only (never credentials) for operators.
echo "${ACTUAL}" >"${ROOT}/pulse-packages-resolved.sha"
echo "ci-verify-pulse-packages: ok"
