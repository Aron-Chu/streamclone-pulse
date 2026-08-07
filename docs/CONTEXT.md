# Context — Streamclone Pulse

Single checkout after [PR #25](https://github.com/Aron-Chu/streamclone-pulse/pull/25)
(`wip/hub-landing` merged). Extension and portal both live in `streamclone-pulse`.

| Piece | Location |
|-------|----------|
| Extension source + spec | `src/`, `docs/pulse-extension/` |
| Command Center portal | `streampulse-web/` on `master` (or feature branch) |
| **Figma UI (PNG exports)** | `docs/pulse-extension/figma/` + `figma-handoff.md` |
| Shared TS scoring | **Current branch override:** sibling `streampulse-backend/packages/pulse-core` (`@streampulse/pulse-core`), validated by `config/local-package-overrides.json` and `scripts/check-package-cohort.mjs`; migration target is Pulse-owned `packages/pulse-core` on `origin/master` |
| Session analytics console UI | **Current branch override:** sibling `streampulse-backend/packages/analytics-console` (`file:` link in `streampulse-web`), validated by `config/local-package-overrides.json`; migration target is Pulse-owned `packages/analytics-console` on `origin/master` |
| BFF + health + bookmarks + recap | **streampulse-backend** `internal/analytics/` |
| Extension local BFF (planned) | `http://localhost:8081` — **streampulse-backend** compose |
| StreamPulse portal (`streampulse-web`) | `https://api.streampulse.stream` (dev default); `npm run dev:local` → local backend opt-in |
| Landing extension showcase | Vite alias `@pulse-ext/ui` → this repo `src/ui` + `extensionUiShimsPlugin` (chrome/storage/bridge stubs) |
| Public Streamclone (watch only) | `http://localhost:8090` — directory/HLS/chat/emotes; **not** extension/portal BFF after split |
| Hosted production deploy | private **streampulse-ops** — dual tags: `IMAGE_TAG` (streamclone watch-core) + `BACKEND_IMAGE_TAG` (`ghcr.io/aron-chu/streampulse/{analytics,migrate,analytics-workers}`) |
| Clip Studio / auto clipper | **replayforge** — contract: [`../../replayforge/docs/INTEGRATION.md`](../../replayforge/docs/INTEGRATION.md) |
| Multi-repo agent index | [`../../streampulse-sdlc/AGENTS.md`](../../streampulse-sdlc/AGENTS.md) |
| Multi-root workspace | [`../../streampulse-sdlc/streampulse-sdlc.code-workspace`](../../streampulse-sdlc/streampulse-sdlc.code-workspace) |

**Hosted API identity:** Probe `GET https://api.streampulse.stream/v1/extension/health` for live version. Pulse BFF ships on the **streampulse-backend** image line (`BACKEND_IMAGE_TAG`). Dated image-exit / release-status notes are historical.

Sibling layout on disk (folder names only — no machine paths):

```text
<workspace>/
  twitch-7tv-clone/       # public Streamclone — desktop Twitch replica (core only after split)
  streampulse-backend/    # private StreamPulse Go BFF + packages
  streamclone-pulse/      # extension + portal (hub worktree retired)
  streampulse-ops/        # private hosted deploy / smoke / evidence
  replayforge/            # Clip Studio + clipper — required for clip handoff
  streampulse-sdlc/       # private multi-repo agent control plane
```

Edit extension and portal in this checkout. Public Streamclone
`docs/pulse-extension/` holds redirect stubs only until deleted.

ReplayForge is required for Clip Studio / auto clipper handoff (candidates → import → render). Normal Pulse extension and StreamPulse portal analytics work does not require a running ReplayForge stack.

Checkout map: [`docs/contributing-wip-split.md`](contributing-wip-split.md).
Portal runbook: [`docs/website-portal/local-dev-runbook.md`](website-portal/local-dev-runbook.md).
