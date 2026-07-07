# Context — Streamclone Pulse extension

| Piece | Location |
|-------|----------|
| **Spec (requirements, design, tasks)** | **This repo** `docs/pulse-extension/` |
| **Figma UI (PNG exports)** | `docs/pulse-extension/figma/` + `figma-handoff.md` |
| Shared TS scoring | `../twitch-7tv-clone/packages/pulse-core` (`@streamclone/pulse-core`) |
| BFF + health + bookmarks + recap | streamclone `internal/analytics/` |
| Extension local stack | `http://localhost:8090` (Caddy in streamclone) |
| StreamPulse portal (`streampulse-web`) | `https://api.streampulse.stream` (dev default); `npm run dev:local` → `:8090` opt-in |
| Multi-root workspace | `../twitch-7tv-clone/streamclone-pulse-extension.code-workspace` |
| Optional ecosystem workspace | `../twitch-7tv-clone/streamclone-full.code-workspace` (Clip Studio / auto clipper only) |

Sibling layout on disk:

```text
C:\Users\Aron\
  twitch-7tv-clone\      # streamclone workspace root (backend)
  streamclone-pulse\     # this repo (extension)
  replayforge\           # standalone Clip Studio / auto clipper, not normal Pulse work
```

Edit product spec here in `docs/pulse-extension/` (requirements status reflects MVP shipped / in progress as of 2026-06). streamclone `docs/pulse-extension/` only has redirect stubs pointing at [Aron-Chu/streamclone-pulse](https://github.com/Aron-Chu/streamclone-pulse).

ReplayForge is only relevant when working on Clip Studio, auto clipper, Streamclone Analytics moment export, or the ReplayForge integration contract. Normal Pulse extension, StreamPulse portal, and public website work does not require opening or editing ReplayForge.

Treat `streamclone-full.code-workspace` as an optional ecosystem workspace, not the default StreamPulse workspace. It exists for cross-repo clipper integration convenience only; it does not make ReplayForge part of the StreamPulse portal or extension product boundary.

Agent skills for the streamclone sibling live in two mirrored trees: **Cursor** `.cursor/skills/streamclone/` and **Codex** `.agents/skills/streamclone/` (sync via `make codex-sync-skills` in streamclone).
