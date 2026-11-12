# StreamPulse Pages deploy runbook (PR #15 hub)

1. **Phase 0:** `@streamclone/analytics-console` stub committed on streamclone `master` (or drop the `file:` dep until P4).
2. **Clean worktree** on pulse `origin/master` (e.g. `chore/pages-deploy-*`).
3. **Public API smoke** from streamclone: `bash scripts/pulse-hosted-boundary-smoke.sh` — require `PUBLIC_BOUNDARY=PASS`.
4. **Explicit production target:** supply `CLOUDFLARE_PAGES_PROJECT=streampulse-main`, `CLOUDFLARE_ACCOUNT_ID`, and a separately checked `PAGES_DEPLOY_EXPECTED_ACCOUNT_ID` in the process environment. Both account values must match the reviewed production-account digest in the release gate. Do not store the identifiers in source or environment files. Missing, legacy, mismatched or unapproved targets fail before dependencies, builds, remote policy checks or uploads. Changing the production account requires a reviewed digest change.
5. **Build & deploy:** from `streampulse-web`, run `npm ci`, then `npm run pages:deploy:prod` (needs `CLOUDFLARE_API_TOKEN` or existing Wrangler OAuth). The release script performs its own build after target validation; there is no project fallback or account-picker path. It rechecks the target and passes the validated account directly to Wrangler immediately before upload.
   `pages:deploy:prod` refuses to build unless `VITE_SENTRY_DSN` (with `SENTRY_AUTH_TOKEN`), `VITE_POSTHOG_PROJECT_TOKEN`, `VITE_TURNSTILE_SITE_KEY` and `VITE_PUBLIC_DISCORD_INVITE_URL` are set and well formed (shell or `.env.production`). To ship without one on purpose, set its waiver to exactly `1`: `PAGES_DEPLOY_ALLOW_NO_SENTRY`, `PAGES_DEPLOY_ALLOW_NO_POSTHOG`, `PAGES_DEPLOY_ALLOW_NO_TURNSTILE` or `PAGES_DEPLOY_ALLOW_NO_DISCORD`; the deploy prints a banner naming it. With a DSN it also confirms the entry bundle carries Sentry debug IDs (prints yes/no).
6. **Post-deploy browser smoke:** `/analytics`, unauth `/analytics/ludwig` → login, `/analytics/streams` → login; hub poll uses `GET /v1/public/hub` only.

Never commit `cloudflaresecrets.txt`, `.env.local`, or beta keys.
