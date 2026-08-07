#!/usr/bin/env bash
# CI: link @streampulse/* packages from streampulse-backend checkout.
set -euo pipefail

PACKAGES_ROOT="../streampulse-backend/packages"

if [[ -f "_streampulse-backend/.package-source.json" ]]; then
  mkdir -p "../streampulse-backend"
  cp "_streampulse-backend/.package-source.json" "../streampulse-backend/.package-source.json"
fi

link_package() {
  local pkg="$1"
  local probe="$2"
  local dest="${PACKAGES_ROOT}/${pkg}"

  if [[ -e "${dest}/${probe}" ]]; then
    echo "ci-link-streampulse-packages: ${pkg} already present at ${dest}"
    return 0
  fi

  local src="_streampulse-backend/packages/${pkg}"
  if [[ ! -e "${src}/${probe}" ]]; then
    echo "ci-link-streampulse-packages: missing ${src}/${probe} (checkout streampulse-backend packages first)" >&2
    exit 1
  fi

  mkdir -p "${PACKAGES_ROOT}"
  rm -rf "${dest}"
  cp -a "${src}" "${dest}"
  echo "ci-link-streampulse-packages: linked ${pkg} from streampulse-backend checkout"
}

link_package pulse-core src/liveHeat.ts
link_package analytics-console src/index.tsx
link_package pulse-charts src/index.ts

if [[ -f "${PACKAGES_ROOT}/pulse-charts/package-lock.json" ]]; then
  npm ci --prefix "${PACKAGES_ROOT}/pulse-charts" --ignore-scripts
fi
