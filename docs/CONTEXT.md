# Context — Streamclone Pulse extension

| Piece | Location |
|-------|----------|
| **Spec (requirements, design, tasks)** | **This repo** `docs/pulse-extension/` |
| **Figma UI (PNG exports)** | `docs/pulse-extension/figma/` + `figma-handoff.md` |
| Shared TS scoring | sibling `streampulse-backend/packages/pulse-core` (`@streampulse/pulse-core`) |
| Session analytics console UI | sibling `streampulse-backend/packages/analytics-console` (`file:` link in `streampulse-web`) |
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
  streamclone-pulse/      # this repo — extension + streampulse-web portal
  streampulse-ops/        # private hosted deploy / smoke / evidence
  replayforge/            # Clip Studio + clipper — required for clip handoff
  streampulse-sdlc/       # private multi-repo agent control plane
```

Edit product spec here in `docs/pulse-extension/`. Public streamclone `docs/pulse-extension/` holds redirect stubs only until deleted.

ReplayForge is required for Clip Studio / auto clipper handoff (candidates → import → render). Normal Pulse extension and StreamPulse portal analytics work does not require a running ReplayForge stack.

## Do not read first (noise / archaeology)

These paths are **not** normative context for active development. Reading them wastes tokens and may introduce stale assumptions:

| Path | Why to skip |
|------|-------------|
| `docs/pulse-extension/evidence/` | Per-session evidence and soak notes — historical only; never authoritative spec |
| `docs/website-portal/release-status.md` | Point-in-time release snapshots; probe hosted health instead |
| Any `release-*` or dated `*-archaeology` file | Historical milestones; superseded by current docs |
| Sections with `HISTORICAL` banners | Explicitly marked stale; skip unless tracing origin |

---

## Context modes (extension vs portal)

| Mode | Scope | Do not load by default |
|------|-------|------------------------|
| **Extension** | `src/`, extension docs | Portal e2e, `streampulse-web` unless needed |
| **Portal / web** | `streampulse-web/`, `docs/website-portal/` | Content scripts, service worker unless API contract |

## Terminology (boundary split)

| Term | Means |
|------|--------|
| **Streamclone** | Public desktop Twitch replica |
| **StreamPulse** | Hosted product (extension + portal + API) |
| **streampulse-backend** | Private Go BFF, ingest, `@streampulse/*` packages |
| **streampulse-ops** | Private deploy, env, SSH |
| **ReplayForge** | Standalone clip jobs / editor / render / artifacts |

Agent skills for backend Pulse work: **streampulse-backend** `.cursor/skills/pulse/`. Portal UX skills: this repo `.cursor/skills/`.
