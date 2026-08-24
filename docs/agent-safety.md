# Agent safety (streamclone-pulse)

## Backend routing

- Go BFF / migrations / ingest: **streampulse-backend**
- Watch / HLS / chat desk: **twitch-7tv-clone** (never Pulse APIs)
- `@streampulse/*` packages: this repo `packages/`

## Untrusted input

- Do not interpolate user/CI strings into `shell: true` commands.
- Prefer argv arrays and allowlists for deploy/project names.
- Extension SW messages must go through validated parsers (`parseBackgroundRequest`).

## Secrets

- Cursor `beforeShellExecution` hooks redact match **labels**, never secret values.
- Cursor hooks are not a substitute for git hooks; install `scripts/pre-commit-public-ops-guard.sh` locally when contributing topology-sensitive docs.