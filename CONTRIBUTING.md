# Contributing

Thanks for interest in **Streamclone Pulse** (Chrome MV3 extension + StreamPulse portal).

[`Aron-Chu/streamclone-pulse`](https://github.com/Aron-Chu/streamclone-pulse) is
**public**. Forks and pull requests are welcome. Historical private history lives
in private `streamclone-pulse-private-archive` (not a contribution surface).

RPR-3/4/5 ingest and support surfaces remain **implementation complete;
activation pending** — feature flags stay off; do not claim active collection.
Store upload remains **RPR-9 pending** (public-source cutover is complete).

## Scope

| In this repo | Elsewhere |
|--------------|-----------|
| Extension (`src/`), portal (`streampulse-web/`), public docs/contracts | StreamPulse BFF / ingest → private **streampulse-backend** |
| Packaging, CI, store listing drafts | Hosted deploy / secrets → private **streampulse-ops** |
| In-repo `@streampulse/*` packages under `packages/*` (RPR-6) | Desktop Twitch replica → public **streamclone** |

Read [`AGENTS.md`](AGENTS.md) and [`docs/pulse-extension/contracts/README.md`](docs/pulse-extension/contracts/README.md) before changing diagnostics, support, or analytics surfaces.

## Setup

```bash
git clone https://github.com/Aron-Chu/streamclone-pulse.git
cd streamclone-pulse
npm install
npm run build:packages
npm run typecheck
npm test
npm run build
```

`@streampulse/pulse-core`, `@streampulse/pulse-charts`, and
`@streampulse/analytics-console` resolve from **in-repo** `packages/*`
(`file:packages/*` / portal `file:../packages/*`). No sibling private checkout
or private package token is required for a clean clone build (RPR-6 complete).

Portal local UI:

```bash
cd streampulse-web
npm install
npm run dev
```

Portal defaults to the hosted API (`https://api.streampulse.stream`). See [`docs/website-portal/local-dev-runbook.md`](docs/website-portal/local-dev-runbook.md).

## Before you push

```bash
npm run typecheck
npm test
npm run build
```

When you touch packaging or store targets, also run the relevant
`npm run validate:package*` / `package:*` scripts.

Default-branch protection requires a PR, conversation resolution, required
status context `CI`, and squash-only merge. See
[`docs/pulse-extension/ruleset-recovery.md`](docs/pulse-extension/ruleset-recovery.md)
(owner recovery only).

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.

Author commits as **Aron-Chu** `<aroncloudchu@gmail.com>`. Do not add agent
`Co-authored-by` trailers.

## Secrets and privacy

- Never commit `.env`, tokens, DSNs, OAuth material, or production topology.
- Do not paste exploit details, raw chat, or credential-shaped strings into issues or PRs.
- Security reports: GitHub Private Vulnerability Reporting ([`SECURITY.md`](SECURITY.md)).
- Privacy / legal: `privacy@streampulse.stream` ([`SUPPORT.md`](SUPPORT.md)).

## More

- Tasks / release gates: [`docs/pulse-extension/tasks.md`](docs/pulse-extension/tasks.md)
- Reliability program: [`docs/pulse-extension/reliability-public-release-plan.md`](docs/pulse-extension/reliability-public-release-plan.md)
- Public cutover evidence: [`docs/evidence/RPR-7-9-public-cutover-20260726.md`](docs/evidence/RPR-7-9-public-cutover-20260726.md)
- Code of conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
