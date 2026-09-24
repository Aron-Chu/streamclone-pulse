# Production and extension audit

Audit time: 2026-09-19, approximately 23:29 UTC. Supersedes earlier handoff claims that hosted clip offsets are unavailable.

## Findings

1. Production deployment persistence is incomplete. Running analytics is v0.2.66 and metadata is v0.3.0-rc30, but saved operator/runtime environment version inputs still name older releases. The temporary environment used for deployment was deleted. Reconcile desired state through the current private ops release process before another deployment.
2. Capacity verification did not establish policy compliance. The verifier without an explicit target passed against runtime's own desired count of 1000. Running with VERIFY_EXPECTED_TARGET=500 fails for desired and active collectors. Current canonical ops policy specifies 500. Do not silently change production capacity during extension work.
3. Release completion was overstated. The watch image build succeeded, but release smoke failed on the MinIO dependency pull and bundle packaging was skipped. Deployment used an older ops branch's tag-based wrapper; current ops main requires signed digest-pinned releases. Live API success does not close those release-process gaps.

## Verified now

- Public extension health: v0.2.66, hosted mode enabled, all reported degraded flags false, viewer sampler successful and fresh.
- Running analytics, workers and metadata containers report healthy.
- All five sampled public xQc clip cards return videoId and vodOffsetSeconds.
- Focused extension unit checks: 35 passed across clip API, chart empty-gap selection, viewport controls, VOD pin preference and Saved Moments.
- One bounded headless browser run: three tests passed in 7.7 seconds. Offline and VOD carousel wheel scrolling and exact bucket pinning pass; adjacent VOD buckets remain selectable with spike markers enabled.

## Extension continuation

The hosted clip-offset prerequisite is available. Continue installed Chrome verification for live and VOD clip selection, carousel appearance, and real-account My Moments persistence. The browser tests above use mocked API responses and do not prove those installed/hosted workflows. Earlier store size evidence had effectively no headroom; remeasure the release artifact after further edits. No store publication or complete visual acceptance is claimed.

This audit made no production changes and did not rebuild the installed extension artifact.
