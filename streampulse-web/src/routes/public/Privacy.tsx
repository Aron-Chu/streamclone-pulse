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
          Last updated: July 24, 2026 · Applies to streampulse.stream and the StreamPulse Chrome
          extension.
        </p>

        <h2>Summary</h2>
        <p>
          StreamPulse shows Twitch stream activity using minute-level aggregates from the StreamPulse
          API. The extension and public site are rollup-first: they do not expose raw chat messages or
          chatter identity to users. The extension does not use Twitch OAuth and does not request
          StreamPulse beta or access keys.
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
          beta keys, access keys, raw chat exports, or chatter identities. Page-context Twitch requests may
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
          The current public-first extension does not request, store, or send a StreamPulse beta key or
          access key.
        </p>
        <p>
          The Chrome extension does <strong>not</strong> currently include optional crash/diagnostics or
          product-analytics SDKs, user consent toggles for those features, or remote challenge scripts.
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
            <strong>chrome.storage.local</strong> — optional debug log entries only when debug logging is
            enabled.
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
          Server-side retention is governed by StreamPulse backend and operations configuration. This policy
          does not claim a fixed public retention period.
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
          For privacy or support questions, email{' '}
          <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a> or visit the{' '}
          <Link to="/support">support page</Link>.
        </p>

        <h2>Changes</h2>
        <p>Material changes to this policy will be reflected on this page with an updated date.</p>
      </article>
    </PublicLayout>
  )
}
