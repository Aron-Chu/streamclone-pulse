import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'

/** Public privacy policy for StreamPulse (portal + Chrome extension). Current behavior only. */
export default function Privacy() {
  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="privacy-policy">
        <p className="muted public-document__back">
          <Link to="/">← StreamPulse</Link>
        </p>
        <h1>Privacy Policy</h1>
        <p className="muted">
          Last updated: August 3, 2026 · Applies to streampulse.stream and the StreamPulse Chrome
          extension.
        </p>

        <h2>Summary</h2>
        <p>
          StreamPulse shows Twitch stream activity using minute-level aggregates from the StreamPulse
           API. The extension and public site are rollup-first: they do not expose raw chat messages or
           chatter identity to users. The extension does not use Twitch OAuth. Protect enrollment is
           optional and uses a beta access key once to create a local device credential.
        </p>

        <h2>What the Chrome extension observes on Twitch</h2>
        <ul>
          <li>The active Twitch page URL, channel login, and stream or VOD identifiers for the tab you are viewing.</li>
          <li>Page-context Twitch metadata needed to resolve the current live stream or VOD for the overlay.</li>
          <li>
            Twitch GraphQL requests performed in the Twitch page context when needed to resolve stream or
            VOD identity for Pulse coverage and backfill flows.
          </li>
        </ul>
        <p>
           The extension does not request or transmit Twitch cookies, passwords, Twitch OAuth credentials,
           raw chat exports, or chatter identities. A beta access key is sent only to the hosted enrollment
           endpoint when you explicitly connect Protect; it is discarded after that request and is not stored
           or sent with later requests. Page-context Twitch requests may
          use your active Twitch browser session through normal browser credential handling. Those requests
          go to Twitch; StreamPulse does not receive your Twitch cookies or Twitch login credentials from
          the extension.
        </p>

        <h2>What is sent to StreamPulse</h2>
        <p>
          The extension service worker sends channel login, stream identifiers, and VOD identifiers, as
          applicable, plus aggregate Pulse and coverage requests, to{' '}
          <code>https://api.streampulse.stream</code> so sanitized rollups, coverage state, and analytics
          can be returned.
        </p>
        <p>
           Protect enrollment is a one-time beta flow. The service worker sends the key only to
           <code>https://api.streampulse.stream/v1/extension/auth/device</code>, then discards it. Later
           protected watchlist requests use an opaque bearer device token stored locally in the extension's
           trusted contexts; the token is never placed in Chrome sync storage and is not sent to local or
           custom backend origins. Without enrollment, a saved channel is only a browser-sync preference and
           is not represented as server-protected.
        </p>
        <p>
          Planned optional extension crash diagnostics are <strong>off by default</strong> and
          require an explicit Options consent toggle (“Share crash diagnostics”) before any
          sanitized report can be prepared. A separate Options toggle (“Share anonymous product
          usage”) controls default-off product analytics consent. Hosted diagnostics upload is not
          active. Product-analytics ingest is not active. The extension does not embed a Sentry or PostHog
          SDK, does not request PostHog host permissions, and does not download or evaluate remotely
          hosted challenge scripts.
        </p>
        <p>
          When product analytics is later activated by StreamPulse, consented installs may send only
          fixed aggregate event names (for example <code>pulse_load_completed</code> and{' '}
          <code>extension_error_shown</code>) through the StreamPulse backend to PostHog for
          processing. Events are non-identifying aggregates (no person profiles, no channel/stream/VOD
          identifiers, no free text). Retention target is about 180 days once activated; this page
          does not claim that activation has occurred.
        </p>

        <h2>What is stored in the browser</h2>
        <ul>
          <li>
            <strong>chrome.storage.sync</strong> — extension preferences such as theme, color scheme,
            overlay placement, chart range, watchlist entries, and related settings that may sync with your
            Chrome profile.
          </li>
          <li>
            <strong>chrome.storage.session</strong> — short-lived Pulse and coverage caches for the current
            browser session.
          </li>
          <li>
             <strong>chrome.storage.local</strong> — the local opaque device token, device identifier, and
             expiry after Protect enrollment; server-confirmed Protect sync metadata and removal tombstones;
             optional debug log entries only when debug logging is enabled; a versioned diagnostics-consent
             record when you opt in via Options (default off); and a separate versioned analytics-consent
             record when you opt in to anonymous product usage (default off). The one-time beta key is not
             stored.
          </li>
          <li>
            <strong>Portal localStorage</strong> — stores recently opened Twitch channel logins
            (<code>sp.hub.recentLogins</code>, capped list), public hub/analytics cache entries keyed by
            backend URL and activity window (<code>sp:publicHub:v1:…</code>, with a staleness hint of about
            10 minutes), and an optional beta key (<code>sp.betaKey</code>) when a gated portal feature is
            used. Clearing site data for streampulse.stream removes these keys.
          </li>
          <li>
            <strong>Portal sessionStorage</strong> — may hold a developer backend URL override
            (<code>sp.backendUrlOverride</code>) in local development builds only. Production portal builds
            do not apply session backend overrides. Clearing site data removes session keys as well.
          </li>
        </ul>

        <h2>External services that receive data</h2>
        <ul>
          <li>
            <strong>StreamPulse API</strong> — the hosted analytics service at
            <code>https://api.streampulse.stream</code>.
          </li>
          <li>
            <strong>Twitch</strong> — page context and GraphQL used to identify streams and VODs on
            twitch.tv.
          </li>
          <li>
            <strong>Emote CDNs</strong> — image assets from providers such as 7TV, Twitch CDN, BetterTTV,
            and FrankerFaceZ when the overlay displays emote art in the browser.
          </li>
          <li>
            <strong>PostHog (product analytics processor, planned)</strong> — only after StreamPulse
            activates the server path and only with separate default-off Options consent. The extension
            never talks to PostHog directly; the StreamPulse backend may forward fixed aggregate event
            names only. Not active in the current extension package.
          </li>
          <li>
            <strong>Website error monitoring (portal only)</strong> — when the streampulse.stream website
            build is configured with an error-monitoring DSN, the portal may send sanitized browser error
            events to that processor. This does not apply to the Chrome extension package. The portal
            scrubbing path is designed to avoid attaching users, cookies, and free-form request bodies.
          </li>
        </ul>
        <p>
          All executable JavaScript for the extension is packaged with the extension. The extension does not
          download or evaluate remotely hosted JavaScript or WebAssembly for product logic.
        </p>

        <h2>Purpose</h2>
        <p>
          Data is used to provide Pulse overlays on Twitch, honest coverage and backfill status, and public
          aggregate analytics. Data is not sold, used for advertising, or used for unrelated profiling.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Browser settings, caches, and optional debug logs remain until you clear them or uninstall the
          extension. Uninstalling removes browser storage for that installation; it does not itself delete
          server-side aggregate rollups or operational logs.
        </p>
        <p>
          A protected watchlist row is server-side state, separate from the browser-sync saved list. Removing
          a channel records a local removal tombstone until the server confirms deletion; temporary DELETE
          failures are retried. Server rows that are merely absent from local sync are not deleted. Revoking
          the device token prevents further authenticated access and removes the token's ability to manage
          Protect; token expiry and revocation are enforced by the StreamPulse backend.
        </p>
        <p>
          Server-side retention is governed by StreamPulse backend and operations configuration. This policy
          does not claim a fixed public retention period for protected watchlist rows, rollups, or operational
          logs. Browser removal and token revocation do not retroactively erase aggregate analytics.
        </p>

        <h2>Chrome Web Store limited use</h2>
        <p>
          User data collected through the extension is used only to provide or improve user-facing
          StreamPulse features. It is not sold or used for advertising or unrelated profiling. Transfers
          needed to operate the product include the StreamPulse API, Twitch page-context requests, and the
          emote image CDNs described above. Portal error monitoring, when enabled for the website build, is
          separate from the extension package.
        </p>

        <h2>Contact</h2>
        <p data-testid="privacy-contact">
          For privacy or legal questions, email{' '}
          <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a> or visit the{' '}
          <Link to="/support">support page</Link>. That mailbox is privacy/legal only — not routine
          product support.
        </p>

        <h2>Changes</h2>
        <p>Material changes to this policy will be reflected on this page with an updated date.</p>
      </article>
    </PublicLayout>
  )
}
