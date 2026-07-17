import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'

/**
 * Public privacy policy for StreamPulse (portal + Chrome extension).
 *
 * Wording is grounded in shipped code. Do not invent contact emails, legal
 * entities, fixed retention periods, or transfer inventories that are not verified.
 */
export default function Privacy() {
  return (
    <PublicLayout>
      <article className="panel privacy-policy" data-testid="privacy-policy">
        <p className="muted" style={{ marginBottom: '0.5rem' }}>
          <Link to="/">← StreamPulse</Link>
        </p>
        <h1>Privacy Policy</h1>
        <p className="muted">
          Last updated: 2026-07-16 · Applies to streampulse.stream and the StreamPulse Chrome
          extension.
        </p>

        <h2>Summary</h2>
        <p>
          StreamPulse shows Twitch stream activity using minute-level aggregates from the StreamPulse
          API. The extension and public site are rollup-first: they do not expose raw chat messages or
          chatter identity to users. The extension does not implement Twitch OAuth for the current
          product.
        </p>

        <h2>What the Chrome extension observes on Twitch</h2>
        <ul>
          <li>The Twitch page URL and channel login for the tab you are viewing.</li>
          <li>
            Page metadata needed to identify the current live stream or VOD (for example stream or
            VOD identifiers available in the page context).
          </li>
          <li>
            Twitch GraphQL requests performed in the page context when needed to resolve stream/VOD
            identity for Pulse coverage and backfill flows.
          </li>
        </ul>
        <p data-testid="privacy-twitch-session">
          The extension does not directly access or extract Twitch cookie values. Twitch GraphQL
          requests made in the page context may use your active Twitch browser session through normal
          browser credential handling (for example <code>credentials: &apos;include&apos;</code> on
          requests to Twitch). Those Twitch requests go to Twitch; StreamPulse does not receive your
          Twitch cookies or Twitch login credentials from the extension.
        </p>

        <h2>What is sent to StreamPulse</h2>
        <p>
          The extension service worker sends channel login, stream identifiers, and VOD identifiers
          (as applicable) to the StreamPulse backend so Pulse rollups, coverage state, and related
          analytics can be returned. Default API host:{' '}
          <code>https://api.streampulse.stream</code>.
        </p>
        <p>
          If you enter a beta / access key in Options, that key is sent on gated API requests via the{' '}
          <code>X-Streamclone-Beta-Key</code> header (legacy header name retained for compatibility).
          Public analytics on streampulse.stream does not require a beta key.
        </p>

        <h2>What is stored in the browser</h2>
        <ul>
          <li>
            <strong>chrome.storage.sync</strong> — extension settings such as theme, overlay
            placement, chart window preference, watchlist entries, and related preferences that may
            sync with your Chrome profile when Chrome Sync is enabled.
          </li>
          <li>
            <strong>chrome.storage.local</strong> — beta / access key (device-local; not synced). If
            a key was previously stored in sync storage, it is migrated to local storage and removed
            from sync on next read. Optional debug log entries are also stored here only when debug
            logging is enabled.
          </li>
          <li>
            <strong>chrome.storage.session</strong> — short-lived Pulse / coverage cache for the
            current browser session.
          </li>
          <li>
            <strong>Portal localStorage</strong> — optional website keys such as{' '}
            <code>sp.betaKey</code> (for gated dashboard features) and{' '}
            <code>sp.backendUrlOverride</code> (developer override). Clearing site data removes them.
          </li>
        </ul>

        <h2>External services that receive data</h2>
        <ul>
          <li>
            <strong>StreamPulse API</strong> — <code>https://api.streampulse.stream</code> (default).
            Local development may optionally use <code>http://localhost:8081</code> after you grant
            optional host permission in the extension.
          </li>
          <li>
            <strong>Twitch</strong> — page context and GraphQL used to identify streams/VODs on
            twitch.tv. Twitch may see your normal browser session for those requests; that is
            separate from data sent to StreamPulse.
          </li>
          <li>
            <strong>Emote CDNs</strong> — image assets from 7TV, Twitch CDN, and FrankerFaceZ when
            the UI displays emote art.
          </li>
        </ul>
        <p>
          The packaged extension ships its own bundled scripts. It is not designed to load remotely
          hosted executable JavaScript or WebAssembly for its own product logic.
        </p>

        <h2>Purpose</h2>
        <p>
          Data is used to provide Pulse overlays on Twitch, honest coverage/backfill status, and
          public aggregate analytics on streampulse.stream. It is not used to sell your personal
          information, serve third-party advertising from this product, or build unrelated
          advertising profiles.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Browser storage (settings, caches, optional beta key, optional debug logs) remains until
          you clear it (for example via extension Options, Chrome’s extension storage / site data
          controls, or uninstalling the extension). Uninstalling the extension removes the
          extension’s local browser storage for that install; it does not by itself guarantee that
          every server-side Pulse rollup or operational log tied to channels you viewed is erased.
        </p>
        <p>
          Server-side retention for rollups and operational logs is governed by StreamPulse backend /
          ops configuration. This page does not define a fixed public retention period.
        </p>
        <p>
          Clearing the beta key in Options (or clearing extension storage) stops sending that key.
          Chrome Sync deletion behavior for synced settings depends on your Chrome account and sync
          settings; clearing local extension storage may not immediately remove every previously
          synced copy on other devices.
        </p>

        <h2>Chrome Web Store limited use</h2>
        <p>
          For Chrome Web Store Limited Use compliance: user data collected via the extension is used
          only to provide or improve user-facing features of StreamPulse, is not sold, and is not
          used for advertising or unrelated profiling. Transfers needed to operate the product
          include the StreamPulse API, Twitch (for page-context identity requests), and emote CDNs
          listed above. This section is not an exhaustive list of every infrastructure or vendor
          subprocessors that may process operational traffic.
        </p>

        <h2>Contact</h2>
        <p data-testid="privacy-contact">
          For privacy or support questions, open an issue at{' '}
          <a
            href="https://github.com/Aron-Chu/streamclone-pulse/issues"
            target="_blank"
            rel="noreferrer"
            data-testid="privacy-contact-link"
          >
            github.com/Aron-Chu/streamclone-pulse/issues
          </a>
          .
        </p>

        <h2>Changes</h2>
        <p>
          Material changes to this policy will be reflected on this page with an updated date.
        </p>
      </article>
    </PublicLayout>
  )
}
