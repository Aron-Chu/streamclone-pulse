#!/usr/bin/env bash
# CI: ensure ../twitch-7tv-clone/packages/pulse-core exists (sibling layout npm file: dep).
set -euo pipefail

PULSE_CORE="../twitch-7tv-clone/packages/pulse-core"
if [[ -f "${PULSE_CORE}/src/liveHeat.ts" ]]; then
  echo "ci-link-pulse-core: pulse-core present at ${PULSE_CORE}"
  exit 0
fi

if [[ ! -d "_streamclone/packages/pulse-core/src" ]]; then
  echo "ci-link-pulse-core: missing _streamclone/packages/pulse-core (run streamclone checkout first)" >&2
  exit 1
fi

mkdir -p "../twitch-7tv-clone/packages"
rm -rf "${PULSE_CORE}"
cp -a "_streamclone/packages/pulse-core" "${PULSE_CORE}"
echo "ci-link-pulse-core: linked ${PULSE_CORE} from streamclone checkout"
