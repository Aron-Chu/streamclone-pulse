# Context — Streamclone Pulse

Single checkout after [PR #25](https://github.com/Aron-Chu/streamclone-pulse/pull/25)
(`wip/hub-landing` merged). Extension and portal both live in `streamclone-pulse`.

| Piece | Location |
|-------|----------|
| Extension source + spec | `src/`, `docs/pulse-extension/` |
| Reliability / public-release plan | [`docs/pulse-extension/reliability-public-release-plan.md`](pulse-extension/reliability-public-release-plan.md) |
| Command Center portal | `streampulse-web/` on `master` (or feature branch) |
| **Figma UI (PNG exports)** | `docs/pulse-extension/figma/` + `figma-handoff.md` |
| Shared TS packages (**target**, R17) | this repo `packages/{pulse-core,pulse-charts,analytics-console}` after RPR-6 |
| Shared TS packages (**current until cutover**) | sibling `streampulse-backend/packages/*` (`@streampulse/*`, often `file:` linked in CI) |
| BFF + health + bookmarks + recap | **streampulse-backend** `internal/analytics/` |
| Extension local BFF (dev opt-in) | `http://localhost:8081` — **streampulse-backend** compose |
| StreamPulse portal (`streampulse-web`) | `https://api.streampulse.stream` (dev default); `npm run dev:local` → local backend opt-in |
| Landing extension showcase | Vite alias `@pulse-ext/ui` → this repo `src/ui` + `extensionUiShimsPlugin` (chrome/storage/bridge stubs) |
| Public Streamclone (watch only) | `http://localhost:8090` — directory/HLS/chat/emotes; **not** extension/portal BFF after split |
| Hosted production deploy | private **streampulse-ops** |
| Clip Studio / auto clipper | **replayforge** — contract: [`../../replayforge/docs/INTEGRATION.md`](../../replayforge/docs/INTEGRATION.md) |
| Multi-repo agent index | [`../../streampulse-sdlc/AGENTS.md`](../../streampulse-sdlc/AGENTS.md) |
| Multi-root workspace | [`../../streampulse-sdlc/streampulse-sdlc.code-workspace`](../../streampulse-sdlc/streampulse-sdlc.code-workspace) |

**Hosted API identity:** Probe `GET https://api.streampulse.stream/v1/extension/health` for live version.

**Polling / consent (planned R14–R15):** Content scripts will own tab-scoped recent polling; the service worker brokers, caches, and coalesces. Full history is explicit-user-action only. Extension diagnostics and product analytics are planned as separate versioned default-off consents. Support form + Turnstile are planned (R16), not current. Store manifests must omit localhost; only development manifests may include `localhost:8081` (R18).

**Portal error monitoring (current):** when `VITE_SENTRY_DSN` is set at website build time, the portal may initialize sanitized browser error reporting. That path is website-only and is not an extension SDK.

**Visibility:** Only `streamclone-pulse` is planned to become newly public (Apache-2.0). Do not publicize backend/ops/replayforge/sdlc.

Sibling layout on disk (folder names only — no machine paths):

```text
<workspace>/
  twitch-7tv-clone/       # public Streamclone — desktop Twitch replica (core only after split)
  streampulse-backend/    # private StreamPulse Go BFF (+ packages until RPR-6 cutover)
  streamclone-pulse/      # extension + portal (+ target public packages)
  streampulse-ops/        # private hosted deploy / smoke / evidence
  replayforge/            # Clip Studio + clipper — required for clip handoff
  streampulse-sdlc/       # private multi-repo agent control plane
```

Edit extension and portal in this checkout. Public Streamclone
`docs/pulse-extension/` holds redirect stubs only until deleted.

ReplayForge is required for Clip Studio / auto clipper handoff (candidates → import → render). Normal Pulse extension and StreamPulse portal analytics work does not require a running ReplayForge stack.

Checkout map: [`docs/contributing-wip-split.md`](contributing-wip-split.md).
Portal runbook: [`docs/website-portal/local-dev-runbook.md`](website-portal/local-dev-runbook.md).
