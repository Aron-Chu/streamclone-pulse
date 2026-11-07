#!/usr/bin/env bash
# Install dependencies for a cloud agent session (Claude Code on the web, Codex cloud).
#
# Claude Code runs this from the SessionStart hook in .claude/settings.json; it exits at
# once outside the cloud. Codex cloud: set the environment's setup script to
#   bash scripts/cloud-setup.sh --cloud
# npm installs are skipped while the package files and this script are unchanged.
set -euo pipefail

if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" && "${1:-}" != "--cloud" ]]; then
  exit 0
fi

cd "$(dirname "$0")/.."

# SessionStart hook stdout lands in Claude's context: send install logs to stderr and
# keep stdout for one summary line.
exec 3>&1 1>&2

# Agents commit as Aron-Chu only (AGENTS.md § Commits). This clone only, never global.
git config user.name Aron-Chu
git config user.email aroncloudchu@gmail.com

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 20 || node_major > 24 )); then
  echo "cloud-setup: Node ${node_major} is outside streampulse-web's range (>=20 <25); use Node 22" >&3
  exit 1
fi

stamp=node_modules/.cloud-setup.sha256
inputs=(
  scripts/cloud-setup.sh
  package.json
  package-lock.json
  packages/*/package.json
  streampulse-web/package.json
  streampulse-web/package-lock.json
)

if sha256sum --check --status "${stamp}" 2>/dev/null; then
  summary="dependencies already installed"
else
  # Drop the old stamp first so a failed install runs again next session.
  rm -f "${stamp}"
  npm ci --no-audit --no-fund
  npm run build:packages
  (cd streampulse-web && npm ci --no-audit --no-fund)
  sha256sum "${inputs[@]}" > "${stamp}"
  summary="installed root + streampulse-web dependencies and built packages/"
fi

# Cheap when packages/*/dist is complete; builds what a fresh pull left missing.
npm run ensure:packages

echo "cloud-setup: Node $(node -v), ${summary}" >&3
