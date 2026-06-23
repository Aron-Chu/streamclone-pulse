# Context — Streamclone Pulse extension

| Piece | Location |
|-------|----------|
| **Spec (requirements, design, tasks)** | **This repo** `docs/pulse-extension/` |
| **Figma UI (PNG exports)** | `docs/pulse-extension/figma/` + `figma-handoff.md` |
| Shared TS scoring | `../twitch-7tv-clone/packages/pulse-core` (`@streamclone/pulse-core`) |
| BFF + health + bookmarks + recap | streamclone `internal/analytics/` |
| Local stack | `http://localhost:8090` (Caddy in streamclone) |
| Multi-root workspace | `../twitch-7tv-clone/streamclone-pulse-extension.code-workspace` |

Sibling layout on disk:

```text
C:\Users\Aron\
  twitch-7tv-clone\      # streamclone workspace root (backend)
  streamclone-pulse\     # this repo (extension)
```

Edit product spec here in `docs/pulse-extension/` (requirements status reflects MVP shipped / in progress as of 2026-06). streamclone `docs/pulse-extension/` only has redirect stubs pointing at [Aron-Chu/streamclone-pulse](https://github.com/Aron-Chu/streamclone-pulse).

Agent skills for the streamclone sibling live in two mirrored trees: **Cursor** `.cursor/skills/streamclone/` and **Codex** `.agents/skills/streamclone/` (sync via `make codex-sync-skills` in streamclone).
