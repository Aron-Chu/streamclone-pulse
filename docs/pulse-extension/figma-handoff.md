# Figma handoff — Streamclone Pulse extension

Codex and other agents **without** Cursor’s Figma plugin should use this file plus the committed PNGs in [`figma/`](figma/). No live Figma MCP required.

## Quick links

| Resource | Location |
|----------|----------|
| **Full board (all frames)** | [`figma/board-full.png`](figma/board-full.png) |
| **Hero — overlay on Twitch** | [`figma/hero-on-twitch.png`](figma/hero-on-twitch.png) |
| **Expanded panel (standalone)** | [`figma/expanded-panel.png`](figma/expanded-panel.png) |
| **Toolbar popup** | [`figma/toolbar-popup.png`](figma/toolbar-popup.png) |
| **Settings** | [`figma/settings.png`](figma/settings.png) |
| **Per-signal lanes (R11)** | [`figma/per-signal-lanes.png`](figma/per-signal-lanes.png) |
| **Saved moments (R10)** | [`figma/saved-moments.png`](figma/saved-moments.png) |
| **Stream recap (R12)** | [`figma/stream-recap.png`](figma/stream-recap.png) |
| **State frames** | `figma/state-*.png`, `figma/live-seek-states.png`, `figma/top-emotes.png` |

## Figma source file

| Field | Value |
|-------|--------|
| File name | `Streamclone Pulse — Chrome Extension` |
| Cloud file key (partial build) | `hogmRcE7znE7jvwdhVyoOa` |
| Cloud URL | https://www.figma.com/design/hogmRcE7znE7jvwdhVyoOa/Streamclone-Pulse-Chrome-Extension |
| Full design board node | `2:2` — **Streamclone Pulse — Extension UI** |
| Page | `0:1` Page 1 |

The complete board was built in Figma desktop via **Figma MCP Bridge**. Until the file is saved to cloud and shared, treat the **PNG exports in this repo** as the design source of truth for agents.

## Frame index (node IDs)

Use these when re-exporting from Figma Bridge (`save_screenshots` or `get_screenshot`).

| Node ID | Frame name | Export file |
|---------|------------|-------------|
| `2:2` | Streamclone Pulse — Extension UI (full board) | `figma/board-full.png` |
| `2:10` | Hero — On Twitch (right dock) | `figma/hero-on-twitch.png` |
| `1:4` | 03 · Expanded panel | `figma/expanded-panel.png` |
| `2:121` | Toolbar popup | `figma/toolbar-popup.png` |
| `2:122` | Settings | `figma/settings.png` |
| `2:123` | Top emotes | `figma/top-emotes.png` |
| `2:124` | Live-seek states | `figma/live-seek-states.png` |
| `2:125` | State · Mini dock | `figma/state-mini-dock.png` |
| `2:126` | State · Collapsed | `figma/state-collapsed.png` |
| `2:127` | State · Warming up | `figma/state-warming-up.png` |
| `2:128` | State · Cannot reach backend | `figma/state-cannot-reach-backend.png` |
| `2:249` | Saved Moments | `figma/saved-moments.png` |
| `2:250` | Per-signal lanes | `figma/per-signal-lanes.png` |
| `2:251` | Stream Recap | `figma/stream-recap.png` |

## Design tokens (from board)

| Token | Hex | Usage |
|-------|-----|--------|
| `bg.canvas` | `#18181b` | Page / Twitch mock background |
| `bg.panel` | `#262633` | Overlay panel, cards |
| `bg.panelElevated` | `#2a2440` | Chips, secondary surfaces |
| `text.primary` | `#fafafc` | Titles, primary labels |
| `text.secondary` | `#a1a1b2` | Subtitles, meta |
| `text.muted` | `#6b7280` | Section caps, timestamps |
| `accent.violet` | `#8b5cf6` | Primary buttons, Pulse brand |
| `accent.violetSoft` | `#c4b5fd` | Peak markers, heat accents |
| `accent.orange` | `#f97316` | Rank #1 / hot moments |
| `border.subtle` | `#3f3f50` | Panel borders (1px inside) |
| `live.green` | `#22c55e` | Live / tracking pill |

Typography: **Inter** — Regular, Medium, Semi Bold, Bold. Panel title ~14–16 Semi Bold; section caps ~9 Semi Bold uppercase; body ~12 Regular.

Layout: overlay docks **right** on Twitch (~320–380px wide expanded). Corner radius: panel **14–16px**, buttons **9px**, pills **13px**.

## Codex workflow (no Figma MCP)

1. Read [`requirements.md`](requirements.md), [`design.md`](design.md), **this file**.
2. Open PNGs under `docs/pulse-extension/figma/` when implementing UI (Codex can read image files in the repo).
3. Match tokens above; parity target is the web `StreamPulsePanel` + lanes/recap requirements (R10–R12).

## Optional — live Figma via Bridge (Cursor or Codex)

Codex can use the same **figma-bridge** MCP as Cursor (no Cursor Figma plugin needed):

```powershell
# streamclone repo
.\scripts\setup-figma-bridge.ps1
```

1. Open **Streamclone Pulse — Chrome Extension** in Figma desktop.
2. Plugins → Development → **Figma MCP Bridge** (manifest: `streamclone/tools/figma-mcp-bridge-plugin/manifest.json`).
3. Reload Codex (`/mcp`) — `figma-bridge` tools should appear.
4. Re-export PNGs: `.\scripts\export-pulse-extension-figma.ps1` (streamclone repo).

## Re-export PNGs

From **streamclone** checkout (Figma file must be open with bridge plugin running):

```powershell
.\scripts\export-pulse-extension-figma.ps1
```

Copies fresh exports into this repo’s `docs/pulse-extension/figma/`.
