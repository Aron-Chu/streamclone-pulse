import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { ChromeInstallCta } from '../../ui/components/ChromeInstallCta'
import { buttonClass } from '../../ui/primitives'

export default function Docs() {
  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="docs-page">
        <header className="mb-6 border-b border-white/[0.08] pb-6">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 rounded bg-violet-500/10 px-2.5 py-1 text-xs font-bold text-violet-300">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
              StreamPulse v0.1.3 Documentation
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white lg:text-4xl">Documentation</h1>
          <p className="mt-2 text-base text-zinc-400">
            Install the Twitch Chrome extension, understand coverage honesty states, and explore the public analytics platform.
          </p>
        </header>

        {/* Feature Grid */}
        <div className="feature-grid">
          <div className="feature-card">
            <span className="feature-card__badge text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              Chrome MV3 Extension
            </span>
            <h3>Twitch Native Overlay</h3>
            <p>
              Injects directly into Twitch chat and VOD playback with a single toggle from <strong>Chat</strong> to <strong>Pulse</strong>.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-card__badge text-violet-300">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              Moment Scoring
            </span>
            <h3>Pulse Reaction Engine</h3>
            <p>
              Detects chat volume spikes, emote explosions, and community velocity peaks in real time.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-card__badge text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Coverage-Honest
            </span>
            <h3>Zero Synthetic Data</h3>
            <p>
              Never fills missing stream minutes with invented activity. Shows clear telemetry badges for every minute.
            </p>
          </div>
        </div>

        {/* Extension Installation */}
        <section id="extension" aria-labelledby="extension-title" className="mt-8 rounded-xl border border-white/[0.08] bg-white/[0.02] p-6">
          <h2 id="extension-title" className="!mt-0 text-xl font-bold text-white">Install the StreamPulse extension</h2>
          <p className="mt-2 text-zinc-300">
            StreamPulse is available on the Chrome Web Store. Install it from the official listing, then open any Twitch
            channel or VOD and switch from <strong>Chat</strong> to <strong>Pulse</strong>.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ChromeInstallCta className={buttonClass('default', 'sm')} data-cta="chrome-install-docs" />
            <span className="text-xs font-mono text-zinc-500">Manifest V3 · Chrome 116+</span>
          </div>
          <div className="alert alert-warning mt-4">
            <span>
              <strong>Security Notice:</strong> Do not install StreamPulse packages from third-party download sites. Use only the official Chrome Web Store listing linked above.
            </span>
          </div>
        </section>

        {/* Coverage States */}
        <section aria-labelledby="coverage-title" className="mt-8">
          <h2 id="coverage-title">Coverage states</h2>
          <p className="text-zinc-400">
            Pulse never fills missing minutes with invented activity. Coverage honesty telemetry informs you exactly how data was collected:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="font-bold text-emerald-300 uppercase text-xs font-mono">Synced</span>
              </div>
              <p className="mt-2 text-xs text-zinc-300">
                The displayed stream window has 100% expected backend coverage and confirmed rollups.
              </p>
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="font-bold text-amber-300 uppercase text-xs font-mono">Collecting</span>
              </div>
              <p className="mt-2 text-xs text-zinc-300">
                Current data is actively arriving via IRC worker collectors in real time.
              </p>
            </div>
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-violet-400" />
                <span className="font-bold text-violet-300 uppercase text-xs font-mono">Partial</span>
              </div>
              <p className="mt-2 text-xs text-zinc-300">
                Only some signals are available (e.g. Helix viewer samples without IRC chat rollups).
              </p>
            </div>
          </div>
        </section>

        {/* Public Analytics */}
        <section aria-labelledby="analytics-title" className="mt-8">
          <h2 id="analytics-title">Public analytics</h2>
          <p className="text-zinc-300">
            <Link to="/analytics" className="font-bold text-violet-400 hover:underline">StreamPulse Analytics</Link> provides aggregate channel, stream, emote, and reaction
            signals without exposing raw chat or chatter identities.
          </p>
          <div className="mt-3 rounded-lg border border-white/[0.08] bg-black/40 p-4 font-mono text-xs text-zinc-400">
            <p className="text-zinc-300 font-bold mb-1">Public API Endpoints:</p>
            <p className="text-emerald-400">GET https://api.streampulse.stream/v1/public/hub</p>
            <p className="text-cyan-400">GET https://api.streampulse.stream/v1/analytics/stream/:streamId/detail</p>
          </div>
        </section>

        {/* Need Help */}
        <section aria-labelledby="help-title" className="mt-8 border-t border-white/[0.08] pt-6">
          <h2 id="help-title">Need help?</h2>
          <p className="text-zinc-400">
            Visit <Link to="/support" className="text-violet-400 hover:underline">StreamPulse Support</Link>, check the <Link to="/status" className="text-violet-400 hover:underline">service status</Link>, or
            read the <Link to="/privacy" className="text-violet-400 hover:underline">privacy policy</Link>.
          </p>
        </section>
      </article>
    </PublicLayout>
  )
}
