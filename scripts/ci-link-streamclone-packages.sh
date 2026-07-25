#!/usr/bin/env bash
# CI: copy @streampulse/* packages ONLY from the just-verified _streampulse-backend checkout.
# Never silently trust a pre-existing sibling ../streampulse-backend/packages tree.
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
VERIFIED_ROOT="${ROOT}/_streampulse-backend"
PACKAGES_ROOT="${ROOT}/../streampulse-backend/packages"
MARKER_NAME=".streampulse-ci-linked-packages"
RESOLVED_SHA_FILE="${ROOT}/pulse-packages-resolved.sha"

if [[ ! -d "${VERIFIED_ROOT}/packages" ]]; then
  echo "ci-link-streampulse-packages: missing verified checkout ${VERIFIED_ROOT}/packages" >&2
  exit 1
fi

RESOLVED_SHA=""
if [[ -f "${RESOLVED_SHA_FILE}" ]]; then
  RESOLVED_SHA="$(tr -d '[:space:]' <"${RESOLVED_SHA_FILE}")"
fi
if [[ -z "${RESOLVED_SHA}" ]]; then
  RESOLVED_SHA="$(git -C "${VERIFIED_ROOT}" rev-parse HEAD 2>/dev/null || true)"
fi
if [[ -z "${RESOLVED_SHA}" ]]; then
  echo "ci-link-streampulse-packages: cannot resolve verified package SHA" >&2
  exit 1
fi
echo "ci-link-streampulse-packages: verified_package_sha=${RESOLVED_SHA}"

# Destination must live under a generated CI sibling layout, never an arbitrary host path.
# Refuse unexpected pre-existing content that was not produced by this linker.
ensure_clean_dest_parent() {
  mkdir -p "$(dirname "${PACKAGES_ROOT}")"
  if [[ -e "${PACKAGES_ROOT}" ]]; then
    if [[ -f "${PACKAGES_ROOT}/${MARKER_NAME}" ]]; then
      local prev
      prev="$(tr -d '[:space:]' <"${PACKAGES_ROOT}/${MARKER_NAME}" || true)"
      echo "ci-link-streampulse-packages: replacing prior CI-linked packages (marker_sha=${prev:-unknown})"
      rm -rf "${PACKAGES_ROOT}"
    else
      echo "ci-link-streampulse-packages: refusing unexpected pre-existing ${PACKAGES_ROOT}" >&2
      echo "ci-link-streampulse-packages: remove it or mark it only via this script (${MARKER_NAME})" >&2
      exit 1
    fi
  fi
  mkdir -p "${PACKAGES_ROOT}"
}

link_package() {
  local pkg="$1"
  local probe="$2"
  local src="${VERIFIED_ROOT}/packages/${pkg}"
  local dest="${PACKAGES_ROOT}/${pkg}"

  if [[ ! -e "${src}/${probe}" ]]; then
    echo "ci-link-streampulse-packages: missing verified source ${src}/${probe}" >&2
    exit 1
  fi

  # Never short-circuit on a pre-existing destination probe — always copy from verified src.
  rm -rf "${dest}"
  cp -a "${src}" "${dest}"
  if [[ ! -e "${dest}/${probe}" ]]; then
    echo "ci-link-streampulse-packages: copy failed for ${pkg}" >&2
    exit 1
  fi
  echo "ci-link-streampulse-packages: linked ${pkg} from verified checkout ${RESOLVED_SHA}"
}

ensure_clean_dest_parent

link_package pulse-core src/liveHeat.ts
link_package analytics-console src/index.tsx
link_package pulse-charts src/index.ts

printf '%s\n' "${RESOLVED_SHA}" >"${PACKAGES_ROOT}/${MARKER_NAME}"
echo "${RESOLVED_SHA}" >"${ROOT}/pulse-packages-linked.sha"
echo "ci-link-streampulse-packages: wrote marker ${PACKAGES_ROOT}/${MARKER_NAME}"

# Install package deps so portal `tsc` can resolve peers (react, etc.) through
# source path mappings on Ubuntu CI.
if [[ -f "${PACKAGES_ROOT}/pulse-charts/package-lock.json" ]]; then
  npm ci --prefix "${PACKAGES_ROOT}/pulse-charts" --ignore-scripts
fi
if [[ -f "${PACKAGES_ROOT}/analytics-console/package-lock.json" ]]; then
  npm ci --prefix "${PACKAGES_ROOT}/analytics-console" --ignore-scripts
fi
if [[ -f "${PACKAGES_ROOT}/pulse-core/package-lock.json" ]]; then
  npm ci --prefix "${PACKAGES_ROOT}/pulse-core" --ignore-scripts
fi
