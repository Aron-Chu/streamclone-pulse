# Session signal fixtures (schemaVersion: session-signal-detail.v1)

Canonical contract fixtures for Truthful Session Tape slice 1.

## Consumers

| Consumer | Path |
|----------|------|
| Go D6 / provenance tests | load from module root: `packages/analytics-console/testdata/*.json` |
| TypeScript adapter tests | `packages/analytics-console/testdata/*.json` via `readFileSync` |
| Portal mapping tests | may import or duplicate minimal fragments; prefer these files |

## Files

| File | Purpose |
|------|---------|
| `session-signal-detail.v1.json` | Full provenance: measured +, measured 0, partial, missing, stale watermark, unknown cell, confirmed peak, gap |
| `session-signal-detail.v1.older-server.json` | Same timeline without provenance fields (quiet adapter path) |
| `session-signal-detail.v1.invalid-wire.json` | Invalid combinations (normalize to unknown / omit) |

Both Go and TypeScript must assert `schemaVersion === "session-signal-detail.v1"`.
Fixture updates require both layers to pass.
