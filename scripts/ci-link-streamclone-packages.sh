#!/usr/bin/env bash
# CI: link pulse-core and analytics-console from the sparse streamclone checkout.
set -euo pipefail

PACKAGES_ROOT="../twitch-7tv-clone/packages"

link_package() {
  local pkg="$1"
  local probe="$2"
  local dest="${PACKAGES_ROOT}/${pkg}"

  if [[ -e "${dest}/${probe}" ]]; then
    echo "ci-link-streamclone-packages: ${pkg} already present at ${dest}"
    return 0
  fi

  local src="_streamclone/packages/${pkg}"
  if [[ ! -e "${src}/${probe}" ]]; then
    echo "ci-link-streamclone-packages: missing ${src}/${probe} (checkout streamclone packages first)" >&2
    exit 1
  fi

  mkdir -p "${PACKAGES_ROOT}"
  rm -rf "${dest}"
  cp -a "${src}" "${dest}"
  echo "ci-link-streamclone-packages: linked ${pkg} from streamclone checkout"
}

link_package pulse-core src/liveHeat.ts
link_package analytics-console src/index.tsx
