# Intentional legacy identifiers (do not rename blindly)

User-facing product name is **StreamPulse**. The identifiers below remain for
compatibility with installed extensions, storage, DOM mounts, headers, and CI
artifact names. Renaming them would break upgrades or contracts.

| Identifier | Where | Why retained |
|------------|-------|--------------|
| npm package `streamclone-pulse` | `package.json` | GitHub repo / package identity |
| Vite lib name `streamclone-pulse-extension` | `vite.config.ts` | Build output identity |
| DOM root `#streamclone-pulse-root` / `#streamclone-pulse-tabs` | content mount + e2e | Existing Twitch page mounts |
| Style root `#streamclone-pulse-styles` | `src/ui/theme.ts` | CSS isolation id |
| HTTP header `X-Streamclone-Beta-Key` | `src/background/api.ts` + BFF | Backend contract |
| Storage key `betaKey` | `chrome.storage` | Installed-user settings |
| Portal keys `sp.betaKey`, `sp.backendUrlOverride` | `streampulse-web` localStorage | Existing portal sessions |
| ZIP / CI names containing `streamclone-pulse` | packaging scripts (if present) | Historical artifact naming |
| Repo folder / GitHub `streamclone-pulse` | Git remote | Repository identity |

When adding new user-visible strings, prefer **StreamPulse**.
