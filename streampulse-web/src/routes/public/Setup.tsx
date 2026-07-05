import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DEFAULT_BACKEND_URL,
  DEFAULT_PRODUCTION_BACKEND_URL,
  getBetaKey,
  setBackendUrlOverride,
  setBetaKey,
} from '../../lib/auth'
import { DEV_BACKEND_ENDPOINTS, devBackendSessionOverrideForPreset } from '../../lib/backendEndpoints'
import { apiClient, getBackendUrl } from '../../lib/apiClient'
import {
  TROUBLE_COPY,
  checkExtensionHealth,
  detectMixedContent,
  formatConnectedMessage,
  type SetupTroubleState,
} from '../../lib/health'
import { CopyConfig } from '../../ui/components/setup/CopyConfig'
import { PublicLayout } from '../../ui/components/PublicLayout'

const CHROME_EXTENSION_URL =
  'https://chrome.google.com/webstore/detail/streamclone-pulse/placeholder'

function detectExtensionInstalled(): boolean {
  const chromeApi = (window as Window & { chrome?: { runtime?: unknown } }).chrome
  return Boolean(chromeApi?.runtime)
}

export default function Setup() {
  const [backendUrl, setBackendUrlField] = useState(DEFAULT_PRODUCTION_BACKEND_URL)
  const [betaKeyInput, setBetaKeyInput] = useState('')
  const [extensionInstalled, setExtensionInstalled] = useState(false)
  const [troubleState, setTroubleState] = useState<SetupTroubleState | null>(null)
  const [healthVersion, setHealthVersion] = useState<string | undefined>()
  const [healthLatencyMs, setHealthLatencyMs] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const installed = detectExtensionInstalled()
    setExtensionInstalled(installed)
    const storedKey = getBetaKey()
    if (storedKey) setBetaKeyInput(storedKey)
    setBackendUrlField(getBackendUrl() || DEFAULT_PRODUCTION_BACKEND_URL)
    if (!installed) setTroubleState('not_installed')
  }, [])

  const mixedContent = useMemo(() => detectMixedContent(backendUrl), [backendUrl])

  const runHealthCheck = useCallback(async () => {
    setBusy(true)
    setTroubleState(null)
    setHealthVersion(undefined)
    setHealthLatencyMs(undefined)
    setBackendUrlOverride(backendUrl)

    if (mixedContent) {
      setTroubleState('mixed_content')
      setBusy(false)
      return
    }

    const health = await checkExtensionHealth(backendUrl)
    if (!health.ok) {
      setTroubleState('unreachable')
      setBusy(false)
      return
    }

    setHealthVersion(health.version)
    setHealthLatencyMs(health.latencyMs)

    const key = betaKeyInput.trim()
    if (key) {
      await setBetaKey(key)
      try {
        await apiClient('/v1/extension/pulse/channels/xqc', { gated: true })
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'kind' in error &&
          (error as { kind: string }).kind === 'unauthorized'
        ) {
          setTroubleState('unauthorized')
          setBusy(false)
          return
        }
      }
    }

    setTroubleState('connected')
    setBusy(false)
  }, [backendUrl, betaKeyInput, mixedContent])

  const trouble = troubleState ? TROUBLE_COPY[troubleState] : null

  return (
    <PublicLayout>
      <section className="stack-md">
        <div>
          <h1>Connect Streamclone Pulse</h1>
          <p className="muted">
            Install the extension, point it at the hosted API, verify health, then start tracking on
            Twitch.
          </p>
        </div>

        <div className="steps">
          <article className="panel step-card">
            <h2>Step 1 — Install</h2>
            <p>
              {extensionInstalled
                ? 'Installed ✓ StreamPulse extension detected in this browser.'
                : 'Install the StreamPulse extension to connect.'}
            </p>
            {!extensionInstalled ? (
              <a className="btn btn-primary" href={CHROME_EXTENSION_URL} target="_blank" rel="noreferrer">
                Add to Chrome
              </a>
            ) : null}
          </article>

          <article className="panel step-card">
            <h2>Step 2 — Connect</h2>
            <p>Set the backend URL and beta key used by the extension options.</p>
            <div className="stack-sm">
              <label className="field-label" htmlFor="backend-url">
                Backend URL
              </label>
              <input
                id="backend-url"
                className="field-input"
                value={backendUrl}
                onChange={(event) => setBackendUrlField(event.target.value.trim())}
                placeholder={DEFAULT_PRODUCTION_BACKEND_URL}
              />
              <div className="stack-sm" role="group" aria-label="Backend presets">
                {DEV_BACKEND_ENDPOINTS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="btn btn-secondary"
                    title={preset.description}
                    onClick={() => {
                      setBackendUrlField(preset.url)
                      setBackendUrlOverride(devBackendSessionOverrideForPreset(preset.id))
                    }}
                  >
                    Use {preset.label}
                  </button>
                ))}
              </div>
              <label className="field-label" htmlFor="beta-key">
                Beta key
              </label>
              <input
                id="beta-key"
                className="field-input"
                value={betaKeyInput}
                onChange={(event) => setBetaKeyInput(event.target.value)}
                placeholder="PULSE-XXXX-XXXX-XXXX"
                autoComplete="off"
              />
              <CopyConfig backendUrl={backendUrl} betaKey={betaKeyInput} />
              <Link to="/login" className="btn btn-secondary" style={{ width: 'fit-content' }}>
                Get a beta key
              </Link>
            </div>
          </article>

          <article className="panel step-card">
            <h2>Step 3 — Verify</h2>
            <p>Run a health check against the hosted API (no beta key required).</p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void runHealthCheck()}
            >
              {busy ? 'Checking…' : 'Run health check'}
            </button>
            {troubleState === 'connected' ? (
              <p className="alert alert-success">{formatConnectedMessage(healthVersion, healthLatencyMs)}</p>
            ) : null}
            {trouble && troubleState !== 'connected' ? (
              <div className="alert alert-warning">
                <strong>{trouble.title}</strong>
                <p style={{ margin: '0.5rem 0 0' }}>{trouble.body.replace('<url>', backendUrl)}</p>
                {trouble.action ? (
                  <p style={{ margin: '0.75rem 0 0' }}>
                    {troubleState === 'not_installed' ? (
                      <a href={CHROME_EXTENSION_URL} target="_blank" rel="noreferrer">
                        {trouble.action}
                      </a>
                    ) : troubleState === 'unauthorized' ? (
                      <Link to="/login">{trouble.action}</Link>
                    ) : troubleState === 'unreachable' ? (
                      <button type="button" className="btn btn-secondary" onClick={() => void runHealthCheck()}>
                        {trouble.action}
                      </button>
                    ) : (
                      trouble.action
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
          </article>

          <article className="panel step-card">
            <h2>Step 4 — Track</h2>
            <p>
              Open any Twitch channel, click Pulse, and start tracking. Your dashboard will reflect
              watched channels once P2 pages land.
            </p>
            <a
              className="btn btn-secondary"
              href="https://www.twitch.tv"
              target="_blank"
              rel="noreferrer"
            >
              Open Twitch
            </a>
          </article>
        </div>

        <p className="muted">
          Local dev backend default: <code>{DEFAULT_BACKEND_URL}</code>
        </p>
      </section>
    </PublicLayout>
  )
}
