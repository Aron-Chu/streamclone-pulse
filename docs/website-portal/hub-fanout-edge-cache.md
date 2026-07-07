# Hub fanout and edge cache (Day 6 soak mitigation)

When public portal traffic spikes `/v1/public/hub`, coordinate **three layers**:

1. **Browser poll discipline** — `usePublicHubData` defaults to **45s** (`VITE_PUBLIC_HUB_POLL_MS`). Landing already passes `pollMs={45_000}`. Do not poll faster than backend Redis hub TTL (~30s) without evidence. Local portal dev defaults: [local-dev-runbook.md](./local-dev-runbook.md).
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
curl -s -D - -o /dev/null "https://api.streampulse.stream/v1/public/hub?activityWindow=30m" | grep -iE 'cache-control|cf-cache-status|x-cache'
bash scripts/ops/verify-public-hub-edge-cache.sh
bash scripts/hosted-launch-probes.sh
```

Expect `Cache-Control: public, max-age=15, s-maxage=30, stale-while-revalidate=60` on every 200.

After the Cloudflare cache rule is enabled, repeat the same `curl` within ~30s:

- `CF-Cache-Status: HIT` (or `REVALIDATED`) — edge cache is serving fanout traffic.
- `CF-Cache-Status: DYNAMIC` — request bypassed Cloudflare cache; the cache rule is not active or a bypass header/cookie matched.

Origin `X-Cache: HIT|MISS` reflects Redis hub cache only; it is independent of Cloudflare edge status.

Canonical soak thresholds: [improvements.md § Day 6](../pulse-extension/evidence/improvements.md).
