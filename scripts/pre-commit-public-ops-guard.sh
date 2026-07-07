#!/usr/bin/env bash
# Block production topology leaks in the public streamclone-pulse repo.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "${ROOT}"

PATTERN='141\.11\.243|23\.173\.152|SHA256:[A-Za-z0-9+/=]{20,}|/root/streampulse-ops|/etc/streamclone/pulse\.env|root@streampulse-vps|id_ed25519_bearhost|PULSE_PROBE_SSH_|streampulse-vps-production-deploy|production\.local\.env'

mapfile -t FILES < <(git diff --cached --name-only --diff-filter=ACM)

violations=0
for f in "${FILES[@]}"; do
  case "${f}" in
    scripts/pre-commit-public-ops-guard.sh|.cursor/rules/public-repo-boundary.mdc|.cursor/plans/*)
      continue
      ;;
  esac
  if rg -n -H "${PATTERN}" "${f}" >/tmp/ops-guard-hit.txt 2>/dev/null; then
    echo "Public ops boundary violation in ${f}:" >&2
    cat /tmp/ops-guard-hit.txt >&2
    violations=1
  fi
done

if [[ "${violations}" -ne 0 ]]; then
  echo "Move operator runbooks and host topology to private streampulse-ops." >&2
  exit 1
fi

exit 0
