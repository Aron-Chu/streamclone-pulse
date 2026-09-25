#!/usr/bin/env bash
# Scan tracked files for production topology / operator leak patterns.
#
# Two rule sets, neither of which stores a private value in this public repo:
#   generic  Value-free shapes, always on: OpenSSH private key blocks, SSH
#            host-key fingerprints, named SSH private-key files, root SSH
#            logins, root-home paths, and env files under /etc.
#   private  The exact operator deny-list, supplied at run time by private
#            streampulse-ops as an extended regex, either inline in
#            STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN or one alternative per line in
#            the file named by STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN_FILE.
#            When neither is set (fork PRs, local runs) the scan says so and
#            runs the generic rules only.
#
# Fail closed: missing git, an unreadable pattern file, or a git grep error is
# a failure (never skip). Never print matching line contents or the private
# pattern; report path, line number, and rule set only.
#
# Usage: scripts/ci-public-topology-scan.sh [--cached]
#   --cached  scan staged content (the index) instead of the working tree;
#             scripts/pre-commit-public-ops-guard.sh uses this mode.
set -euo pipefail

mode="worktree"
case "${1:-}" in
  "") ;;
  --cached) mode="cached" ;;
  *)
    echo "usage: $0 [--cached]" >&2
    exit 2
    ;;
esac

if ! command -v git >/dev/null 2>&1; then
  echo "ci-public-topology-scan FAILED: git is required" >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "${ROOT}"

# Bracketed spaces keep this file from matching its own rules.
GENERIC_PATTERN='BEGIN[ ]OPENSSH[ ]PRIVATE[ ]KEY|SHA256:[A-Za-z0-9+/=]{20,}|id_(rsa|dsa|ecdsa|ed25519)_[A-Za-z0-9][A-Za-z0-9_-]*|root@[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]|/root/[A-Za-z0-9._-]+|/etc/[A-Za-z0-9._-]+/[A-Za-z0-9._-]*\.env'

PRIVATE_PATTERN="${STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN:-}"
if [[ -z "${PRIVATE_PATTERN}" && -n "${STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN_FILE:-}" ]]; then
  if [[ ! -r "${STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN_FILE}" ]]; then
    echo "ci-public-topology-scan FAILED: STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN_FILE is not readable" >&2
    exit 1
  fi
  PRIVATE_PATTERN="$(tr -d '\r' <"${STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN_FILE}" | grep -v -e '^[[:space:]]*$' -e '^#' | paste -sd '|' - || true)"
  if [[ -z "${PRIVATE_PATTERN}" ]]; then
    echo "ci-public-topology-scan FAILED: STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN_FILE has no patterns" >&2
    exit 1
  fi
fi

if [[ "${mode}" == "cached" ]]; then
  mapfile -t FILES < <(git ls-files --cached)
else
  mapfile -t FILES < <(git ls-files)
fi
if [[ "${#FILES[@]}" -eq 0 ]]; then
  echo "ci-public-topology-scan FAILED: git ls-files returned no tracked files" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT
violations=0

# $1 = rule-set label, $2 = extended regex. Reports path + line only.
scan_rule_set() {
  local label="$1"
  local pattern="$2"
  local -a grep_args=(grep -I -n -E)
  if [[ "${mode}" == "cached" ]]; then
    grep_args+=(--cached)
  fi
  set +e
  git "${grep_args[@]}" -e "${pattern}" -- . >"${tmp}" 2>/dev/null
  local greprc=$?
  set -e
  # git grep: 0 = matches, 1 = no matches, >=2 = error
  if [[ "${greprc}" -ge 2 ]]; then
    echo "ci-public-topology-scan FAILED: git grep error in ${label} rules (rc=${greprc})" >&2
    exit 1
  fi
  if [[ -s "${tmp}" ]]; then
    local line file rest lineno
    while IFS= read -r line; do
      file="${line%%:*}"
      rest="${line#*:}"
      lineno="${rest%%:*}"
      echo "topology-hit rule=${label} file=${file} line=${lineno}" >&2
      violations=1
    done <"${tmp}"
  fi
}

scan_rule_set generic "${GENERIC_PATTERN}"
if [[ -n "${PRIVATE_PATTERN}" ]]; then
  scan_rule_set private "${PRIVATE_PATTERN}"
  private_state="private deny-list applied"
else
  private_state="private deny-list not configured; generic rules only"
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    echo "::warning::Public topology scan ran without STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN; generic rules only"
  fi
fi

if [[ "${violations}" -ne 0 ]]; then
  echo "Public topology scan FAILED — move host IPs / SSH / operator paths to streampulse-ops." >&2
  exit 1
fi

echo "ci-public-topology-scan OK (${mode}, scanned ${#FILES[@]} tracked files, ${private_state})"
exit 0
