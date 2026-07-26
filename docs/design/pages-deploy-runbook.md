# StreamPulse Pages deploy runbook (PR #15 hub)

1. **Phase 0:** `@streamclone/analytics-console` stub committed on streamclone `master` (or drop the `file:` dep until P4).
2. **Clean worktree** on pulse `origin/master` (e.g. `chore/pages-deploy-*`).
3. **Public API smoke** from streamclone: `bash scripts/pulse-hosted-boundary-smoke.sh` — require `PUBLIC_BOUNDARY=PASS`.
4. **Build & deploy:** `cd streampulse-web && set VITE_BACKEND_URL=https://api.streampulse.stream && npm ci && npm run build && npm run pages:deploy:prod` (needs `CLOUDFLARE_API_TOKEN` or wrangler login).
5. **Post-deploy browser smoke:** `/analytics`, unauth `/analytics/ludwig` → login, `/analytics/streams` → login; hub poll uses `GET /v1/public/hub` only.

Never commit `cloudflaresecrets.txt`, `.env.local`, or beta keys.
