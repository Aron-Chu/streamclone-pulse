# Supporter lifecycle and extension verification

Date: 2026-09-11. Scope: local working trees, including existing uncommitted work.
This is local implementation evidence, not production release approval.

## Implemented

- More visible Stream Pulse header with a persistent settings button.
- Supporter banner preview, Glass/Etched/Halo selection, equip and reset.
- Account/environment-scoped preferences persisted by the billing backend.
- Paid appearance requires verified, unexpired banner and finish entitlements.
  The content script receives only a finish and bounded lifetime, never account
  credentials or subscription details. Expired/unavailable access fails closed.
- Corrected persisted entitlement access windows, feature projection, paid-through
  date and support-period projection. Existing projections require reconciliation.
- Backend rejects checkout for known existing subscriptions; existing attempt
  idempotency remains in place. This is not a provider-wide uniqueness proof.
- Billing and checkout-return pages, trusted Stripe redirect destinations,
  pending/error states, and membership-management navigation.
- Analytics support/account menu and valid metadata for Supporter, terms, refunds.

Shared public Twitch chat badges remain unavailable. Core analytics stays free.

## Verification

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Extension `npm test -- --run` | 162 files, 1,211 tests passed | Unit/component tests |
| Extension `npm run typecheck` | Passed | TypeScript |
| Extension `npm run build` | Passed | Canonical local `dist/` |
| Extension `npm run check:bundle-budget` | Passed | 580,167 raw / 168,300 gzip bytes; exactly gzip limit |
| Packaged extension Playwright, `--project=extension-mocked --workers=2` | 91 passed | Fresh unpacked Chromium, mocked Twitch/API |
| Portal `npx vitest run` | 172 files, 1,214 tests passed | Unit/component tests |
| Portal `npm run build:ci` | Passed | Includes route, overlap, public-page and 206-link checks |
| Portal `supporter-billing-review.spec.ts` | Passed | Local Vite; desktop 1440 and mobile 390; mocked billing |
| Backend billing/accounts/config Go tests | Passed | Billing/account Postgres integration enabled against isolated test database |

Extension browser coverage includes chart hover/lock/keyboard/zoom/pan, selected
moments, recap/VOD states, emote selection limits, accents/density, sidebar/right/
bottom placement, mini/hide/reopen, Chat focus, quick/full settings synchronization,
SPA navigation/reinjection/relaunch, error/timeout/malformed responses, polling
guards, account linking/disconnect, message authorization and Supporter states.
Narrow settings checks cover 320/390/768 widths; design checks cover 125/150% zoom.

The new packaged cosmetic test equips each finish, verifies the rendered header,
reloads settings to verify persistence, resets, expires access and checks removal.
Twitch content scripts cannot call account, entitlement or equip transports.

Purchase lifecycle tests cover purchase, cancellation retaining paid access,
renewal grace, grace expiry, refund, dispute and resubscription through actual
Postgres projection storage. Additional tests exercise existing-subscription
rejection, preference persistence, revoked-device denial and environment isolation.
Provider responses in local tests are fixtures/fakes, not actual Stripe charges.

The initial quick-settings failure was an obsolete `Right` assertion; the current
label is `Right dock`. The panel remained present. Chart-wheel assertions were
aligned with existing modifier/viewport behavior. Visual baselines were reviewed
before updating the affected screenshots; the subsequent full suite passed.

## Visual evidence

Generated files are local test artifacts and may be replaced by later runs:

- `test-results/supporter-offer/banner-glass.png`
- `test-results/supporter-offer/banner-etched.png`
- `test-results/supporter-offer/banner-halo.png`
- `test-results/supporter-offer/supporter-active.png`
- `test-results/design-audit/17-live-sidebar-compact-density.png`
- `test-results/design-audit/24-browser-zoom-150.png`
- Portal `test-results/supporter-billing-review-a-5b5db-at-desktop-and-mobile-sizes-chromium/analytics-menu-390.png`
- Same portal directory: `analytics-menu-1440.png`, `billing-active.png`,
  `billing-pending.png`, `billing-grace.png`, `billing-expired.png`,
  `billing-unavailable.png`.

Inspected screenshots show the stronger header hierarchy and finish color bands,
reachable settings, and mobile menu/billing content without horizontal overflow.
The Twitch background in these screenshots is intentionally a test fixture.

## Remaining release requirements

- No actual Stripe test-mode checkout, provider dashboard configuration, webhook
  delivery, renewal test clock, provider refund or customer-portal cancellation
  was executed. These require the configured provider test environment.
- No fresh Resend delivery or bounce/suppression workflow was executed. Account
  Redis integration and live SMTP tests were not enabled in this run. The earlier
  configuration review identified account/email runtime and DMARC follow-up work;
  private operational evidence remains with the ops owner.
- Apply backend migration `100013_pulse_entitlement_access_window` and reconcile
  projections as part of a separately verified deployment. Nothing was deployed.
- Recognition derives from eligible billing intervals; duplicate/overlapping
  interval accounting warrants a dedicated provider-ledger review before launch.
- The passing suite is broad local coverage, not proof of every live Twitch,
  Stripe, email or hosted production combination. Public offer availability must
  match the deployed account/billing services.
- Repo-wide whitespace checks found existing blank-EOF issues in unrelated
  popup/past-VOD and backend hub-test files. Those were left in place.

## Local handoff

Portal: `http://127.0.0.1:5173/analytics` and `/account/billing`.
The billing page correctly stays unavailable when its same-origin API is absent.

Extension build: `streamclone-pulse/dist`, provenance parent
`67835af7d6e138bf35806598b59d9f269a9b7207`, dirty inputs. Tests loaded this build
in fresh automation profiles. The user's installed Chrome extension has NOT been
verified as reloaded: manually reload it at `chrome://extensions`, then refresh
Twitch. No commits, production deployment, real payment or email send occurred.
