import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { ChromeInstallCta } from '../../ui/components/ChromeInstallCta'
import { FirefoxInstallCta } from '../../ui/components/FirefoxInstallCta'
import { buttonClass } from '../../ui/primitives'
import { discordInviteUrl } from '../../lib/discord'
import { FEEDBACK_PATH } from '../../lib/externalLinks'
import { feedbackSiteKey, supportFormAvailability } from '../../lib/supportForm'

export default function Docs() {
  const discord = discordInviteUrl()
  // Until the private form is switched on, "Need help?" points at the feedback
  // page (which lists public places to ask) instead of promising private feedback.
  const formReady = supportFormAvailability(feedbackSiteKey()) === 'ready'
  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="docs-page">
        <header className="mb-6 border-b border-white/[0.08] pb-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300">StreamPulse guide</p>
          <h1 className="text-3xl font-black tracking-tight text-white lg:text-4xl">Get started with Pulse</h1>
          <p className="mt-2 text-base text-zinc-400">
            Install the extension, read the data clearly, and find help when you need it.
          </p>
        </header>

        <nav className="public-toc" aria-label="On this page">
          <a href="#extension">Install</a>
          <a href="#analytics">Use Analytics</a>
          <a href="#coverage">Data coverage</a>
          <a href="#help">Help</a>
        </nav>

        {/* Extension Installation */}
        <section id="extension" aria-labelledby="extension-title" className="mt-8 rounded-xl border border-white/[0.08] bg-white/[0.02] p-6">
          <h2 id="extension-title" className="!mt-0 text-xl font-bold text-white">1. Install the StreamPulse extension</h2>
          <p className="mt-2 text-zinc-300">
            For Chrome and Brave, use the Chrome Web Store. For Firefox, use Firefox Add-ons.
            Then open a Twitch channel or VOD: <strong>Pulse</strong> opens by default.
            Use the <strong>Chat / Pulse</strong> switch at the top of Twitch chat to change tabs.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ChromeInstallCta className={buttonClass('default', 'sm')} data-cta="chrome-install-docs" />
            <FirefoxInstallCta className={buttonClass('outline', 'sm')} />
            <span className="text-xs text-zinc-500">The extension version shown in the store listing identifies the published package, not the website release.</span>
          </div>
          <p className="mt-3 text-sm text-zinc-300">
            Install using a desktop browser. On a phone or tablet, open this page on your computer.
            An Edge Add-ons link will appear here once its listing is verified.
          </p>
          <div className="alert alert-warning mt-4">
            <span>
              <strong>Security Notice:</strong> Do not install StreamPulse packages from third-party download sites.
              Use only official StreamPulse listings linked from this site in the Chrome Web Store,
              Microsoft Edge Add-ons or Firefox Add-ons.
            </span>
          </div>
        </section>

        {/* Public Analytics */}
        <section id="analytics" aria-labelledby="analytics-title" className="mt-8">
          <h2 id="analytics-title">2. Explore Analytics</h2>
          <p className="text-zinc-300">
            <Link to="/analytics" className="font-bold text-violet-400 hover:underline">StreamPulse Analytics</Link> provides aggregate channel, stream, emote, and reaction
            signals without exposing raw chat or chatter identities.
          </p>
          <ol className="mt-3 space-y-2">
            <li>Start with Overview, then explore Moments, Emotes, or Channels.</li>
            <li>Check the displayed time window and coverage before comparing numbers.</li>
            <li>Open a moment to inspect its stream timestamp. Video may be pending or unavailable even when analytics exist.</li>
            <li>Share the timestamped stream link to return to the same broadcast and moment.</li>
          </ol>
        </section>

        <section className="mt-8" aria-labelledby="workflow-guides-title">
          <h2 id="workflow-guides-title">Tools and workflow guides</h2>
          <ul>
            <li><Link to="/tools/twitch-vod-timestamp-link">Build a Twitch VOD timestamp link</Link> from a video and a known player time.</li>
            <li><Link to="/guides/find-twitch-moments">Find and bookmark tracked reaction moments</Link> with an editor/mod review workflow.</li>
            <li><Link to="/guides/twitch-vod-timestamps">Understand Twitch replay availability and timestamps</Link> before sharing.</li>
          </ul>
        </section>

        {/* Coverage States */}
        <section id="coverage" aria-labelledby="coverage-title" className="mt-8">
          <h2 id="coverage-title">3. Read coverage correctly</h2>
          <p className="text-zinc-400">
            Coverage describes the selected measurement window, not a guarantee that every minute of the broadcast was captured. Live status and data freshness are separate:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="font-bold text-emerald-300 uppercase text-xs font-mono">Synced</span>
              </div>
              <p className="mt-2 text-xs text-zinc-300">
                Minute-level signals are available. Check the window and coverage counts; synced does not necessarily mean the whole broadcast is complete.
              </p>
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="font-bold text-amber-300 uppercase text-xs font-mono">Collecting</span>
              </div>
              <p className="mt-2 text-xs text-zinc-300">
                New measurements are arriving. Earlier minutes may still be missing.
              </p>
            </div>
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-violet-400" />
                <span className="font-bold text-violet-300 uppercase text-xs font-mono">Partial</span>
              </div>
              <p className="mt-2 text-xs text-zinc-300">
                Only some minutes or signals are available, such as viewers without chat measurements. Gaps are not zero activity.
              </p>
            </div>
          </div>
        </section>
        <details className="mt-8 rounded-lg border border-white/[0.08] px-4 py-3">
          <summary className="cursor-pointer font-semibold text-zinc-200">Developer reference</summary>
          <div id="api" className="pt-3 text-sm text-zinc-400">
            <p>These read-only aggregate endpoints power the portal. Respect rate limits and cache responses; no media access or creator permissions are granted by public analytics.</p>
            <div className="public-api-reference mt-3 rounded-lg border border-white/[0.08] bg-black/40 p-4 font-mono text-xs text-zinc-400">
              <p><code>GET https://api.streampulse.stream/v1/public/hub?activityWindow=30m</code></p>
              <p><code>GET https://api.streampulse.stream/v1/portal/analytics/streams/:streamId</code></p>
            </div>
          </div>
        </details>

        {/* Need Help */}
        <section id="help" aria-labelledby="help-title" className="mt-8 border-t border-white/[0.08] pt-6">
          <h2 id="help-title">Need help?</h2>
          <p className="text-zinc-400" data-testid="docs-help">
            {formReady
              ? <>Send <Link to={FEEDBACK_PATH} className="text-violet-400 hover:underline">private feedback</Link> about a bug or an idea</>
              : <>For a bug or an idea, see the <Link to={FEEDBACK_PATH} className="text-violet-400 hover:underline">feedback page</Link></>}
            {discord ? <>, or ask in the{' '}
              <a href={discord} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline" aria-label="Discord (opens in a new tab)">Discord</a></> : null}.
            You can also visit <Link to="/support" className="text-violet-400 hover:underline">StreamPulse Support</Link>, check the <Link to="/status" className="text-violet-400 hover:underline">service status</Link>, or
            read the <Link to="/privacy" className="text-violet-400 hover:underline">privacy policy</Link>.
          </p>
        </section>
      </article>
    </PublicLayout>
  )
}
