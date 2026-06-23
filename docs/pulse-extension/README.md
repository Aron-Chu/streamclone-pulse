# Pulse extension

Chrome MV3 overlay for Twitch. Canonical specs:

- [requirements.md](./requirements.md)
- [design.md](./design.md)
- [tasks.md](./tasks.md)
- [figma-handoff.md](./figma-handoff.md)

## Sidebar layout

When **Overlay placement** is **Sidebar tab**, Pulse splits into two shadow-DOM hosts:

1. **Chrome bar** — fixed near the top of the chat column: **Chat | Pulse**, **Mini**, **Hide**
2. **Panel** — covers only the **chat messages area** (below Twitch’s gift/sub header)

Use **Chat** to interact with Twitch chat normally. Use **Pulse** for analytics over the message list.

## 7TV extension coexistence

Pulse and the **7TV browser extension** are designed to work together:

| | 7TV extension | Streamclone Pulse |
|--|---------------|-------------------|
| DOM | Injects into Twitch chat for emote rendering | Shadow DOM overlay only — never mutates Twitch chat |
| Data | Client-side emote sets in the browser | Streamclone backend IRC rollups (`sevenTvEmoteCount`, top emotes) |
| Chat use | Always when chat is visible | **Chat tab** (or **Hide** → pill): transparent overlay, Twitch + 7TV chat fully interactive |

**Recommended workflow with both installed:**

1. **Chat tab** (or **Hide** → pill): watch Twitch chat with 7TV emotes normally; gift/sub header stays clickable.
2. **Pulse tab**: analytics overlay over the message area only; chat input remains usable when the messages rect excludes the input bar.
3. Pulse **Top emotes** come from your Streamclone stack, not from 7TV’s in-page dictionary — no duplicate emote pipeline.

### Manual checklist (Twitch + 7TV + Pulse)

- [ ] **Chat tab:** send a message, 7TV emotes render, gift header clickable
- [ ] **Pulse tab:** analytics visible, no overlap with gift header
- [ ] **Mini:** compact pulse strip; **Chat tab** restores full chat
- [ ] **Hide:** pill in chrome bar; **Chat tab** still works
- [ ] **Theater / popout chat:** Pulse falls back to floating right dock
