# Context — how this repo connects to Streamclone

| Piece | Location |
|-------|----------|
| Canonical spec | `../twitch-7tv-clone/docs/pulse-extension/` |
| Shared TS scoring | `../twitch-7tv-clone/packages/pulse-core` (`@streamclone/pulse-core`) |
| BFF + health endpoints | Streamclone `internal/analytics/extension_api.go` |
| Local stack URL | `http://localhost:8090` via Caddy |
| Multi-root workspace | `../twitch-7tv-clone/streamclone-pulse-extension.code-workspace` |

Extension `file:` dependency path in `package.json` assumes sibling folders:

```text
C:\Users\Aron\
  twitch-7tv-clone\     # Streamclone source
  streamclone-pulse\    # this repo
```

Do not duplicate the full requirements/design markdown here — link to Streamclone and edit the canonical files there.
