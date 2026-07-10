#!/usr/bin/env bash
# Scan public product trees for production topology / operator leak patterns.
# Allow-list: boundary rules, guard scripts, and wildcard IP examples only.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "${ROOT}"

PATTERN='141\.11\.243\.[0-9]+|23\.173\.152\.[0-9]+|SHA256:[A-Za-z0-9+/=]{20,}|/root/streampulse-ops|/etc/streamclone/pulse\.env|root@streampulse-vps|id_ed25519_bearhost|PULSE_PROBE_SSH_|streampulse-vps-production-deploy|production\.local\.env|BEGIN OPENSSH PRIVATE KEY'

ALLOW_RE='public-repo-boundary|pre-commit-public-ops-guard|ci-public-topology-scan|secrets-scan-pre-commit|forbidden_public_patterns|legacy-rollback-host|hosted-production-vps|private-streampulse-ops|filter-repo-'

SCAN_GLOBS=(
  'AGENTS.md'
  'CLAUDE.md'
  'docs'
  '.cursor'
  'scripts'
)

violations=0
tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

if command -v rg >/dev/null 2>&1; then
  for g in "${SCAN_GLOBS[@]}"; do
    if [[ -e "${g}" ]]; then
      rg -n -H --glob '!**/node_modules/**' --glob '!**/archive/**' --glob '!**/evidence/**' \
        --glob '!**/plans/**' -e "${PATTERN}" "${g}" >>"${tmp}" 2>/dev/null || true
    fi
  done
else
  echo "WARN: ripgrep (rg) not found — skipping topology content scan" >&2
  exit 0
fi

if [[ -s "${tmp}" ]]; then
  while IFS= read -r line; do
    file="${line%%:*}"
    if echo "${file}" | grep -Eq "${ALLOW_RE}"; then
      continue
    fi
    echo "${line}" >&2
    violations=1
  done <"${tmp}"
fi

if [[ "${violations}" -ne 0 ]]; then
  echo "Public topology scan FAILED — move host IPs / SSH / operator paths to streampulse-ops." >&2
  exit 1
fi

echo "ci-public-topology-scan OK"
exit 0
