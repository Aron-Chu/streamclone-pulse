# Opus prompt — independent StreamPulse extension release audit

Audit the current StreamPulse Chrome extension release candidate independently. Start at
`C:\Users\Aron\streampulse-sdlc\AGENTS.md` and `boundary.json`, then read
`C:\Users\Aron\streamclone-pulse\AGENTS.md` and only the relevant release,
supporter, and portal contracts. Read the backend router before reviewing
`C:\Users\Aron\streampulse-backend` billing code. The checkouts have extensive
pre-existing uncommitted work: preserve it exactly. Analyze without editing
source or tracked artifacts; local test/build outputs may be regenerated for
verification. Do not commit, reset, deploy, publish, alter Stripe configuration,
or make a charge.
Never print secrets, private topology, customer identifiers, or tokens.

Answer whether the **current source**, a **fresh local development build**, the
**store-target package**, the **published Chrome Web Store version**, the
**installed Chrome extension**, and the **hosted portal/API** are the same or
different. Do not infer equality from matching semantic version numbers or from
the existing `dist/` directory. Record the exact SHA, branch, dirty status,
build provenance, package target, dashboard evidence boundary, and CI run/job
status for any release claim. If browser policy prevents inspecting an installed
extension, say it is unverified and request a user-provided version/build-ID
screenshot; do not work around the policy.

Check these release gates against evidence, not checkboxes:

1. Re-run focused unit/type/build/package checks and local packaged-extension
   Playwright, including supporter settings at 320, 390, and desktop widths.
   Inspect actual screenshots for settings hierarchy, contrast, badge stages
   from New through 24 months, the 18 px chat-size preview, and any overflow.
2. Verify every extension-linked portal route is live and serves its intended
   page: `/supporter`, `/account/billing`, `/account/sign-in`,
   `/account/link-device`, `/changelog`, `/terms`, `/refunds`, `/support/`, and
   `/privacy/`. Check portal release SHA and the portal-before-extension gate.
3. Check the public Chrome Web Store listing version and Support destination,
   then distinguish those observations from the publisher dashboard fields.
   Compare the candidate version to the confirmed published/dashboard version.
   Inspect the store-target ZIP for localhost permissions, source maps, secrets,
   remote code, and a matching attestation. Do not use a development ZIP.
4. Trace paid access server to client. Prove free analytics stays free; expired,
   disconnected, refunded, disputed, unavailable, and revoked accounts fail
   closed for paid finishes and recognition. Confirm the shared Twitch chat
   badge is described as preview-only and never sold as an existing feature.
5. Check connected Stripe **sandbox** product/price, Checkout, signed webhook
   delivery, customer portal, cancellation, renewal, refund, dispute, and tax
   behavior. Separate code/fixture tests from a real sandbox Checkout-to-webhook-
   to-Postgres-to-extension proof. Verify hosted account/billing routes and
   runtime flags before claiming subscribers can buy or unlock anything.
6. Review recognition math: two separately paid overlapping intervals must
   advance tenure once; adjacent distinct months must advance twice. Check
   the 24-month threshold, existing projection reconciliation, and tests for
   resubscription/refund/dispute. Distinguish visual preview selection from
   earned service-reported status.
7. Review settings UX beyond the badge: quick-settings first-screen controls,
   full appearance preview, Supporter promotion duplication, narrow navigation,
   token consistency, keyboard behavior, and honest links/copy.

Starting hypotheses to verify afresh (do not treat these as proof): on
2026-09-24 the public listing showed 0.2.1 and linked Support to Twitch; seven
product/policy routes and hosted account/billing routes returned 404; the
connected Stripe account was sandbox-only with no webhook destination; the
checkout was heavily uncommitted and the prior local `dist/` was a stale
development build. The badge progression and tenure counting received local
uncommitted edits during this audit and require independent review.

Report: (a) a clear **release / no-release** verdict; (b) blockers ranked by
severity with exact file/line or URL and observed response; (c) a table of
source, tested, deployed, installed, and published identities; (d) tests run,
skipped, and their proof limits; (e) a minimal ordered closure plan with the
owner-only dashboard, deployment, and store-upload gates called out. Do not
mark a gate complete without direct evidence.
