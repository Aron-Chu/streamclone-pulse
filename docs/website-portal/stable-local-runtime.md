# Stable local portal runtime

The ordinary portal command follows the current working tree:

```powershell
cd C:\Users\Aron\streamclone-pulse\streampulse-web
npm run dev
```

That is useful for WIP, but it is intentionally mutable. The portal uses
explicit `file:` links to the sibling `streampulse-backend/packages` checkout,
so a restart can serve newer sibling source even when the portal checkout did
not change. The build identity banner reports that state, but it cannot make a
filesystem link immutable.

For reproducible local QA, capture an external snapshot first:

```powershell
cd C:\Users\Aron\streamclone-pulse\streampulse-web
npm run runtime:capture -- --id portal-qa-2026-08-06
npm run runtime:verify -- --id portal-qa-2026-08-06
npm run dev:stable -- --id portal-qa-2026-08-06
```

The snapshot command copies the current portal WIP, extension UI aliases, and
the three linked `@streampulse/*` packages into `%TEMP%\streampulse-portal-snapshots`
by default. It records portal/backend commits, dirty state, Node/npm versions,
and SHA-256 content fingerprints. It never resets, stashes, deletes, or edits
the source checkouts.

The stable launcher verifies the snapshot before startup, installs dependencies
inside the snapshot only, and starts a strict `127.0.0.1:5174` server using the
hosted API. It fails closed on source/package drift or a port collision. The
`/healthz` response and development banner include the snapshot ID, mode,
source fingerprint, and package-cohort fingerprint.

`2h` and `6h` are not currently distinct hosted activity windows. The backend
normalizes them to the canonical 30-minute response. A 24-hour request can be
`state=degraded`, `source=live_pool_fallback`, and
`reason=historical_projection_unavailable`, with only about 30 minutes of
trustworthy history. The UI must describe that limitation; it must not imply
that synthetic empty buckets are measured zero activity.

## Auto-agent handoff prompt

Use this prompt when handing the next portal task to an autonomous agent:

> Work only in the StreamPulse portal ownership boundary (`streamclone-pulse`)
> and preserve all existing user WIP. Before changing UI, run a read-only
> inventory of the portal branch, dirty paths, sibling package cohort, current
> `:5174` process command line, `/healthz`, and hosted `/v1/public/hub` for
> `30m`, `2h`, `6h`, and `24h`. Treat the repository and sibling package links as
> mutable until proven otherwise. For stable QA, capture and verify an external
> snapshot with `npm run runtime:capture`, `npm run runtime:verify`, and
> `npm run dev:stable`; do not use `git reset`, `git checkout`, `git clean`, or
> `stash`. Preserve API degradation metadata (`state`, `source`, `reason`, and
> available history) through normalization. Never render missing history as
> ordinary zero activity. Maintain a single activity chart and a single Pulse
> Moments bucket filter. Selection must work with mouse, touch tap, keyboard,
> outside-click, and the visible Clear button; vertical touch scrolling must not
> select. Keep the current activity-ranked Hottest live rail. Do not resurrect
> the deleted hero wholesale or invent a remembered colored-letter treatment
> without repository evidence; if the design is not recoverable, document that
> fact and use explicit trust/degraded copy. Add focused tests before editing
> shared contracts, run typecheck, focused tests, build, and the real browser
> smoke path (`/analytics`, bucket select, Clear, outside click, keyboard, and
> touch). Re-check `/healthz` twice after a fresh stop/start and require the same
> snapshot identity. Review the diff and leave commits untouched unless the
> operator explicitly authorizes a commit.

## Runtime identity contract

The stable lane is valid only when all of these agree across two independent
`/healthz` requests after restart:

| Field | Meaning |
| --- | --- |
| `snapshotId` | External snapshot selected by the launcher |
| `sourceFingerprint` | Portal/source content identity |
| `packageCohortFingerprint` | Linked package content identity |
| `serviceGeneration` | Server generation derived from the identity |

If any value changes unexpectedly, stop the QA run and investigate the runtime
instead of treating the page as a new app version.
