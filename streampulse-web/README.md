# StreamPulse web

Vite + React portal for StreamPulse. Requires sibling **streamclone** checkout at `../../twitch-7tv-clone` for `@streamclone/pulse-core`.

```bash
npm install
npm run dev          # http://localhost:5173 — set VITE_BACKEND_URL=http://localhost:8090
npm run typecheck && npm test && npm run build
```

Production API: `VITE_BACKEND_URL=https://api.streampulse.stream`
