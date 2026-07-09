# Context — Streamclone Pulse extension

| Piece | Location |
|-------|----------|
| **Spec (requirements, design, tasks)** | **This repo** `docs/pulse-extension/` |
| **Figma UI (PNG exports)** | `docs/pulse-extension/figma/` + `figma-handoff.md` |
| Shared TS scoring | `../../streampulse-backend/packages/pulse-core` (`@streampulse/pulse-core`) |
| BFF + health + bookmarks + recap | **streampulse-backend** `internal/analytics/` |
| Extension local BFF (planned) | `http://localhost:8081` — **streampulse-backend** compose |
| StreamPulse portal (`streampulse-web`) | `https://api.streampulse.stream` (dev default); `npm run dev:local` → local backend opt-in |
| Public Streamclone (watch only) | `http://localhost:8090` — directory/HLS/chat/emotes; **not** extension/portal BFF after split |
| Hosted production deploy | private **streampulse-ops** |
| Multi-root workspace | `../../twitch-7tv-clone/streampulse-extension.code-workspace` (trim to pulse + backend when workspace updated) |

Sibling layout on disk:

```text
C:\Users\Aron\
  twitch-7tv-clone\       # public Streamclone — desktop Twitch replica (core only after split)
  streampulse-backend\    # private StreamPulse Go BFF + packages (local scaffold)
  streamclone-pulse\      # this repo — extension + streampulse-web portal
  replayforge\            # standalone Clip Studio — optional integration only
```

Edit product spec here in `docs/pulse-extension/`. Public streamclone `docs/pulse-extension/` holds redirect stubs only until deleted.

ReplayForge is only relevant for Clip Studio / auto clipper integration. Normal Pulse extension and StreamPulse portal work does not require ReplayForge.

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

Agent skills for backend Pulse work: **streampulse-backend** `.cursor/skills/pulse/`. Portal UX skills: this repo `.cursor/skills/`.
