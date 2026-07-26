# Contributing

Thanks for interest in **Streamclone Pulse** (Chrome MV3 extension + StreamPulse portal).

Publication / GitHub visibility change is **RPR-9 owner-authorized only**. Do not
assume public fork/PR workflows until that gate flips. Historical private archive
rename target (owner-authorized): `streamclone-pulse-private-archive`.

RPR-3/4/5 ingest and support surfaces remain **implementation complete;
activation pending** — feature flags stay off; do not claim active collection.

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

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.

Author commits as **Aron-Chu** `<aroncloudchu@gmail.com>`. Do not add agent
`Co-authored-by` trailers.

## Secrets and privacy

- Never commit `.env`, tokens, DSNs, OAuth material, or production topology.
- Do not paste exploit details, raw chat, or credential-shaped strings into issues or PRs.
- Public contact today: `privacy@streampulse.stream` only (see [`SUPPORT.md`](SUPPORT.md), [`SECURITY.md`](SECURITY.md)).

## More

- Tasks / release gates: [`docs/pulse-extension/tasks.md`](docs/pulse-extension/tasks.md)
- Reliability program: [`docs/pulse-extension/reliability-public-release-plan.md`](docs/pulse-extension/reliability-public-release-plan.md)
- Code of conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
