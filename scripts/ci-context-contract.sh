#!/usr/bin/env bash
# Owner-local Pulse context gate — deterministic for forks and isolated CI.
# Cross-repo truth lives in private streampulse-sdlc workspace mode.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ROOT="$(git -C "${SCRIPT_DIR}/.." rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
cd "${ROOT}"

fail() { echo "FAIL: $*" >&2; exit 1; }

grep -q 'streampulse-sdlc/AGENTS.md' AGENTS.md \
  || fail "AGENTS.md must link streampulse-sdlc/AGENTS.md"

grep -q 'https://api.streampulse.stream' AGENTS.md \
  || fail "AGENTS.md must document hosted API default"

grep -qE 'localhost:8081|http://localhost:8081' AGENTS.md \
  || fail "AGENTS.md must document local Pulse BFF :8081"

if grep -nE 'default.*backend.*localhost:80[9]0|Backend URL \(default `?http://localhost:80[9]0' \
  AGENTS.md .cursor/rules/*.mdc 2>/dev/null | grep -viE 'watch-only|not |never |only for'; then
  fail "product agent surface still teaches :8090 as BFF"
fi

[[ -f streampulse-web/package.json ]] || fail "missing streampulse-web/package.json"
grep -q '"check:analytics-overlap"' streampulse-web/package.json \
  || fail "streampulse-web missing check:analytics-overlap script"
grep -q 'check-analytics-overlap' streampulse-web/package.json \
  || fail "streampulse-web build must invoke analytics overlap check"
[[ -f streampulse-web/scripts/check-analytics-overlap.mjs ]] \
  || fail "missing check-analytics-overlap.mjs"
[[ -f scripts/ci-public-topology-scan.sh ]] \
  || fail "missing ci-public-topology-scan.sh"

# Prefer sibling SDLC repo-mode when present (same invariants, additional coverage).
if [[ -f ../streampulse-sdlc/scripts/context-contract-check.py ]]; then
  PY=""
  for candidate in "${HOME}/.local/bin/python3.14" python3 python; do
    if command -v "${candidate}" >/dev/null 2>&1 && "${candidate}" -c "import sys" >/dev/null 2>&1; then
      PY="${candidate}"
      break
    fi
    if [[ -x "${candidate}" ]]; then
      PY="${candidate}"
      break
    fi
  done
  if [[ -n "${PY}" ]]; then
    "${PY}" ../streampulse-sdlc/scripts/context-contract-check.py \
      --mode repo --repo streamclone-pulse --repo-path "${ROOT}" --workspace-root "$(cd .. && pwd)"
  fi
fi

echo "pulse owner-local context-contract OK"

# Wrong always-on backend routing must stay fixed.
if grep -nE 'Backend changes →.*twitch-7tv-clone|implement Go APIs there' .cursor/rules/streamclone.mdc 2>/dev/null; then
  fail "streamclone.mdc still routes Go backend work to twitch-7tv-clone"
fi
grep -q 'streampulse-backend' .cursor/rules/streamclone.mdc \
  || fail "streamclone.mdc must name streampulse-backend for Go/BFF work"
grep -q 'redacted' .cursor/hooks/secrets-scan-pre-commit.py \
  || fail "secrets hook must document redaction"
