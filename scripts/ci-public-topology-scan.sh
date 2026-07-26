#!/usr/bin/env bash
# Scan ALL tracked files for production topology / operator leak patterns.
# Fail closed: missing scan tooling or git is an error (never skip).
# Do not print matching line contents (may contain sensitive material) —
# report path + line number only.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "${ROOT}"

PATTERN='141\.11\.243\.[0-9]+|23\.173\.152\.[0-9]+|SHA256:[A-Za-z0-9+/=]{20,}|/root/streampulse-ops|/etc/streamclone/pulse\.env|root@streampulse-vps|id_ed25519_bearhost|PULSE_PROBE_SSH_|streampulse-vps-production-deploy|production\.local\.env|BEGIN OPENSSH PRIVATE KEY'

ALLOW_RE='public-repo-boundary|pre-commit-public-ops-guard|ci-public-topology-scan|secrets-scan-pre-commit|forbidden_public_patterns|legacy-rollback-host|hosted-production-vps|private-streampulse-ops|filter-repo-'

if ! command -v git >/dev/null 2>&1; then
  echo "ci-public-topology-scan FAILED: git is required" >&2
  exit 1
fi

mapfile -t FILES < <(git ls-files)
if [[ "${#FILES[@]}" -eq 0 ]]; then
  echo "ci-public-topology-scan FAILED: git ls-files returned no tracked files" >&2
  exit 1
fi

violations=0
tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

set +e
git grep -I -n -E -e "${PATTERN}" -- . >"${tmp}" 2>/dev/null
greprc=$?
set -e
# git grep: 0 = matches, 1 = no matches, >=2 = error
if [[ "${greprc}" -ge 2 ]]; then
  echo "ci-public-topology-scan FAILED: git grep error (rc=${greprc})" >&2
  exit 1
fi

if [[ -s "${tmp}" ]]; then
  while IFS= read -r line; do
    file="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"
    if echo "${file}" | grep -Eq "${ALLOW_RE}"; then
      continue
    fi
    echo "topology-hit file=${file} line=${lineno}" >&2
    violations=1
  done <"${tmp}"
fi

if [[ "${violations}" -ne 0 ]]; then
  echo "Public topology scan FAILED — move host IPs / SSH / operator paths to streampulse-ops." >&2
  exit 1
fi

echo "ci-public-topology-scan OK (scanned ${#FILES[@]} tracked files)"
exit 0
