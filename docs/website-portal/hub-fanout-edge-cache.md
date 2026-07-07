# Hub fanout and edge cache (Day 6 soak mitigation)

When public portal traffic spikes `/v1/public/hub`, coordinate **three layers**:

1. **Browser poll discipline** — `usePublicHubData` defaults to **45s** (`VITE_PUBLIC_HUB_POLL_MS`). Landing already passes `pollMs={45_000}`. Do not poll faster than backend Redis hub TTL (~30s) without evidence.
2. **Origin cache headers** — analytics sets `Cache-Control: public, max-age=15, s-maxage=30, stale-while-revalidate=60` on `/v1/public/hub`. Cloudflare may cache sanitized JSON at the edge when no `Authorization` cookie is present.
3. **Edge rate limits** — in Cloudflare dashboard for `api.streampulse.stream`, add WAF/rate rules for `/v1/public/*` before search/bot discovery (improvements #14).

## Cloudflare cache rule (suggested)

| Setting | Value |
|---------|-------|
| URL | `api.streampulse.stream/v1/public/hub*` |
| Cache eligibility | Eligible for cache |
| Edge TTL | 30s |
| Browser TTL | respect origin (`max-age=15`) |
| Bypass | requests with beta/admin headers |

## Verify

```bash
curl -sI "https://api.streampulse.stream/v1/public/hub?activityWindow=30m" | grep -i cache-control
bash scripts/hosted-launch-probes.sh
```

Canonical soak thresholds: [improvements.md § Day 6](../pulse-extension/evidence/improvements.md).
