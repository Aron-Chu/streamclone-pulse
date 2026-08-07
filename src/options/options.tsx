import { createRoot } from 'react-dom/client'
import { useEffect, useState, type CSSProperties } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  DEFAULT_AUTO_TRACK_POLICY,
  DEFAULT_BACKEND_URL,
  DEFAULT_POLL_INTERVAL_MS,
  POLL_INTERVAL_OPTIONS_MS,
  clearSessionPulseCache,
  getAutoTrackPolicy,
  getBackendUrl,
  getPollIntervalMs,
  getThemePreference,
  isLocalStackBackendUrl,
  setAutoTrackPolicy,
  setBackendUrl,
  setPollIntervalMs,
  type AutoTrackPolicy,
} from '../shared/storage.ts'
import {
  extensionBackendSourceCaption,
  resolveExtensionBackendSource,
} from '../shared/backendSource.ts'
import { normalizeLogin } from '../shared/login.ts'
import {
  clearPulseDebugLog,
  getPulseDebugEnabled,
  getPulseDebugLog,
  initPulseDebug,
  setPulseDebugEnabled,
  type PulseDebugEntry,
} from '../shared/pulseDebug.ts'
import { applyAccentTheme } from '../ui/overlayTheme.ts'
import { injectStyles, theme } from '../ui/theme.ts'

const buildMeta = typeof __STREAMPULSE_BUILD_META__ === 'undefined' ? null : __STREAMPULSE_BUILD_META__

function OptionsApp() {
  const [backendUrl, setBackendUrlState] = useState(DEFAULT_BACKEND_URL)
  const [pollMs, setPollMsState] = useState(DEFAULT_POLL_INTERVAL_MS)
  const [autoTrackPolicy, setAutoTrackPolicyState] = useState<AutoTrackPolicy>(DEFAULT_AUTO_TRACK_POLICY)
  const [watchlist, setWatchlistState] = useState<string[]>([])
  const [channelInput, setChannelInput] = useState('')
  const [savedFlash, setSavedFlash] = useState('')
  const [health, setHealth] = useState('Not checked')
  const [watchlistError, setWatchlistError] = useState('')
  const [debugLogging, setDebugLogging] = useState(false)
  const [debugLog, setDebugLog] = useState<PulseDebugEntry[]>([])
  const [debugCopied, setDebugCopied] = useState(false)
  const localStackBackend = isLocalStackBackendUrl(backendUrl)
  const backendSource = resolveExtensionBackendSource(backendUrl)
  const hostedBackend = backendSource === 'hosted'

  useEffect(() => {
    injectStyles()
    void (async () => {
      await initPulseDebug()
      applyAccentTheme(await getThemePreference())
      setBackendUrlState(await getBackendUrl())
      setPollMsState(await getPollIntervalMs())
      setAutoTrackPolicyState(await getAutoTrackPolicy())
      setDebugLogging(await getPulseDebugEnabled())
      await refreshWatchlist()
      await refreshDebugLog()
    })()
  }, [])

  function flashSaved(label: string): void {
    setSavedFlash(label)
    window.setTimeout(() => setSavedFlash(''), 1500)
  }

  async function refreshWatchlist(): Promise<void> {
    try {
      const res = await sendBackgroundMessage({ type: 'LIST_WATCHLIST' })
      if ('type' in res && res.type === 'WATCHLIST') {
        setWatchlistState(res.channels)
      }
    } catch {
      setWatchlistState([])
    }
  }

  async function persistBackendUrl(url: string): Promise<void> {
    await setBackendUrl(url)
    flashSaved('Backend URL saved')
    await sendBackgroundMessage({ type: 'SYNC_WATCHLIST' })
    await refreshWatchlist()
  }

  async function persistPollMs(ms: number): Promise<void> {
    setPollMsState(ms)
    await setPollIntervalMs(ms)
    flashSaved('Polling interval saved')
  }

  async function persistAutoTrack(policy: AutoTrackPolicy): Promise<void> {
    setAutoTrackPolicyState(policy)
    await setAutoTrackPolicy(policy)
    flashSaved('Auto-track saved')
  }

  async function clearCachedPulseData(): Promise<void> {
    const confirmed = window.confirm(
      'Clear cached Pulse and coverage snapshots for this browser session? Charts will refetch on the next open channel.',
    )
    if (!confirmed) return
    await clearSessionPulseCache()
    flashSaved('Cleared')
  }

  async function refreshDebugLog(): Promise<void> {
    setDebugLog(await getPulseDebugLog())
  }

  async function toggleDebugLogging(enabled: boolean): Promise<void> {
    await setPulseDebugEnabled(enabled)
    setDebugLogging(enabled)
    if (!enabled) {
      setDebugLog([])
    } else {
      await refreshDebugLog()
    }
  }

  async function copyDebugLog(): Promise<void> {
    const text = debugLog
      .map(entry => {
        const ts = new Date(entry.ts).toISOString()
        const data = entry.data ? ` ${JSON.stringify(entry.data)}` : ''
        return `[${ts}] ${entry.level} ${entry.step}: ${entry.message}${data}`
      })
      .join('\n')
    await navigator.clipboard.writeText(text || '(empty)')
    setDebugCopied(true)
    setTimeout(() => setDebugCopied(false), 1500)
  }

  async function probeHealth(): Promise<void> {
    setHealth('Checking...')
    try {
      const res = await sendBackgroundMessage({ type: 'HEALTH' })
      if ('type' in res && res.type === 'HEALTH' && res.ok) {
        const helix =
          res.helixEnabled === true
            ? 'Helix on'
            : res.helixEnabled === false
              ? 'Helix off'
              : 'Helix unknown (redeploy analytics)'
        setHealth(`Backend OK (${res.version ?? 'dev'}) · ${helix}`)
      } else {
        setHealth('Backend unreachable')
      }
    } catch {
      setHealth('Backend unreachable')
    }
    if (debugLogging) {
      await refreshDebugLog()
    }
  }

  async function addChannel(): Promise<void> {
    setWatchlistError('')
    const login = normalizeLogin(channelInput)
    if (!login) {
      setWatchlistError('Enter a valid Twitch login (letters, numbers, underscore).')
      return
    }
    try {
      const res = await sendBackgroundMessage({ type: 'ADD_WATCHLIST', login })
      if ('type' in res && res.type === 'WATCHLIST') {
        setWatchlistState(res.channels)
        setChannelInput('')
      }
    } catch (err) {
      setWatchlistError(err instanceof Error ? err.message : 'Could not add channel.')
    }
  }

  async function removeChannel(login: string): Promise<void> {
    setWatchlistError('')
    try {
      const res = await sendBackgroundMessage({ type: 'REMOVE_WATCHLIST', login })
      if ('type' in res && res.type === 'WATCHLIST') {
        setWatchlistState(res.channels)
      }
    } catch (err) {
      setWatchlistError(err instanceof Error ? err.message : 'Could not remove channel.')
    }
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Advanced settings</h1>
          <p style={styles.lead}>
            Backend, watchlist/Protect, and debug tools. Day-to-day settings live in the Pulse sidebar → gear.
          </p>
        </div>
        <button type="button" style={styles.secondaryButton} onClick={() => void probeHealth()}>Probe backend</button>
      </header>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Backend source</span>
        <div
          style={{
            ...styles.backendBanner,
            ...(hostedBackend ? styles.backendBannerHosted : styles.backendBannerWarn),
          }}
          role="status"
        >
          <strong>{extensionBackendSourceCaption(backendUrl)}</strong>
          {hostedBackend ? (
            <p style={styles.help}>
              Default production API — matches the public StreamPulse portal at{' '}
              <code>streampulse.stream/analytics</code>. No local stack required.
            </p>
          ) : localStackBackend ? (
            <p style={styles.help}>
              Local StreamPulse backend (<code>make up</code> in <code>streampulse-backend</code> on port 8081).
              Charts and IRC coverage can differ from hosted public analytics — use only for BFF development.
              Streamclone <code>:8090</code> is watch/HLS/chat only and does not serve extension APIs.
            </p>
          ) : (
            <p style={styles.help}>
              Custom API host — verify it matches the portal you expect. Hosted production is{' '}
              <code>{DEFAULT_BACKEND_URL}</code>.
            </p>
          )}
          {!hostedBackend ? (
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => {
                setBackendUrlState(DEFAULT_BACKEND_URL)
                void persistBackendUrl(DEFAULT_BACKEND_URL)
              }}
            >
              Reset to hosted API
            </button>
          ) : null}
        </div>
        <label style={styles.label}>
          <span>Backend URL</span>
          <input
            value={backendUrl}
            onChange={e => setBackendUrlState(e.target.value)}
            onBlur={() => void persistBackendUrl(backendUrl)}
            placeholder={DEFAULT_BACKEND_URL}
            style={styles.input}
          />
        </label>
        <div style={styles.status}>{health}</div>
        {savedFlash ? <p style={styles.saved}>{savedFlash}</p> : null}
      </section>

      {buildMeta ? (
        <section style={styles.section} aria-label="Extension build identity">
          <span style={styles.groupLabel}>Extension build identity</span>
          <p style={styles.help}>
            <code>{buildMeta.buildId}</code> · {buildMeta.mode} · {buildMeta.dirty ? 'dirty source' : 'clean source'}
          </p>
          <p style={styles.help}>
            Input fingerprint <code>{buildMeta.sourceFingerprint.slice(0, 12)}</code> · package cohort{' '}
            <code>{buildMeta.packageCohortFingerprint.slice(0, 12)}</code>
          </p>
        </section>
      ) : null}

      <section style={styles.section} aria-label="Cached Pulse data">
        <span style={styles.groupLabel}>Cached Pulse data</span>
        <p style={styles.help}>
          Session Pulse and coverage snapshots. Same clear path the service worker uses when the build id or package
          cohort changes.
        </p>
        <button type="button" style={styles.secondaryButton} onClick={() => void clearCachedPulseData()}>
          Clear cached Pulse data
        </button>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Watchlist / Protect</span>
        <p style={styles.help}>
          On <strong>hosted</strong> StreamPulse, saved channels sync as backend Protect for when capacity scales —
          they do <strong>not</strong> enable live Pulse or backfill in the extension today. Use the{' '}
          <strong>Analytics hub</strong> to browse actively tracked channels. On a <strong>local</strong> backend (
          <code>localhost:8081</code>), watchlist entries also start IRC while your stack runs.
        </p>
        <div style={styles.watchRow}>
          <input
            value={channelInput}
            onChange={e => setChannelInput(e.target.value)}
            placeholder="channel login, e.g. aikobliss"
            style={styles.input}
            onKeyDown={event => {
              if (event.key === 'Enter') void addChannel()
            }}
          />
          <button type="button" style={styles.secondaryButton} onClick={() => void addChannel()}>Add</button>
        </div>
        {watchlistError ? <p style={styles.errorText}>{watchlistError}</p> : null}
        {watchlist.length === 0 ? (
          <p style={styles.help}>
            No channels yet. On hosted, adding a login saves Protect for later — live Pulse stays hub-only until we scale.
          </p>
        ) : (
          <ul style={styles.watchlist}>
            {watchlist.map(login => (
              <li key={login} style={styles.watchItem}>
                <span>{login}</span>
                <button type="button" style={styles.linkButton} onClick={() => void removeChannel(login)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Polling interval</span>
        <div style={styles.segmented}>
          {POLL_INTERVAL_OPTIONS_MS.map(value => (
            <button
              key={value}
              type="button"
              style={pollMs === value ? styles.segmentActive : styles.segment}
              onClick={() => void persistPollMs(value)}
            >
              {value / 1000}s
            </button>
          ))}
        </div>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Auto-track on Twitch</span>
        {localStackBackend ? (
          <>
            <select
              value={autoTrackPolicy}
              onChange={e => void persistAutoTrack(e.target.value as AutoTrackPolicy)}
              style={styles.input}
            >
              <option value="off">Manual only — use Track channel in the overlay (local stack)</option>
              <option value="followed">Track the channel page you open (local stack only)</option>
              <option value="ask">Ask before tracking (watchlist still auto-tracks on local stack)</option>
            </select>
            <p style={styles.help}>
              Local stack only — starts IRC when you open a channel (policy above). On hosted, IRC is managed by the live pool.
            </p>
          </>
        ) : (
          <p style={styles.help}>Local-stack only — hidden on hosted.</p>
        )}
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Debug logging (VOD / jump / backfill)</span>
        <p style={styles.help}>
          Turn on to record step-by-step VOD discovery, jump/seek confirmation, Helix health, pulse API, and backfill results. Use this when
          &quot;Jump in player&quot; freezes or &quot;Check for VOD &amp; load from start&quot; fails — the log shows the player range, target, and blocking step.
        </p>
        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={debugLogging}
            onChange={event => void toggleDebugLogging(event.target.checked)}
          />
          Enable debug logging
        </label>
        <div style={styles.debugActions}>
          <button type="button" style={styles.secondaryButton} onClick={() => void refreshDebugLog()} disabled={!debugLogging}>
            Refresh log
          </button>
          <button type="button" style={styles.secondaryButton} onClick={() => void copyDebugLog()} disabled={!debugLogging || debugLog.length === 0}>
            Copy log
          </button>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => void clearPulseDebugLog().then(refreshDebugLog)}
            disabled={!debugLogging || debugLog.length === 0}
          >
            Clear
          </button>
        </div>
        {debugCopied ? <p style={styles.saved}>Debug log copied.</p> : null}
        {debugLogging ? (
          debugLog.length === 0 ? (
            <p style={styles.help}>No entries yet. Enable logging, reload the extension, open a live channel, then click &quot;Jump in player&quot;.</p>
          ) : (
            <pre style={styles.debugPre}>
              {debugLog
                .slice(-20)
                .map(entry => {
                  const ts = new Date(entry.ts).toLocaleTimeString()
                  return `${ts} [${entry.level}] ${entry.step}\n  ${entry.message}${entry.data ? `\n  ${JSON.stringify(entry.data)}` : ''}`
                })
                .join('\n\n')}
            </pre>
          )
        ) : null}
      </section>

      <footer style={styles.footer}>
        <a href="https://streampulse.stream/privacy" target="_blank" rel="noreferrer" style={styles.footerLink}>
          Privacy policy
        </a>
      </footer>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    background: theme.bgCanvas,
    color: theme.textPrimary,
    fontFamily: theme.font,
    margin: 0,
    minHeight: '100vh',
    padding: 24,
    width: 620,
  },
  header: { alignItems: 'flex-start', display: 'flex', gap: 16, justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 22, margin: '0 0 6px' },
  lead: { color: theme.textSecondary, fontSize: 13, lineHeight: 1.45, margin: 0, maxWidth: 460 },
  section: { borderTop: `1px solid ${theme.border}`, display: 'grid', gap: 10, padding: '16px 0' },
  label: { display: 'grid', gap: 8, fontSize: 13, fontWeight: 800 },
  groupLabel: { color: theme.textSecondary, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' },
  checkboxRow: { alignItems: 'center', display: 'flex', fontSize: 13, fontWeight: 700, gap: 8 },
  help: { color: theme.textMuted, fontSize: 12, lineHeight: 1.45, margin: 0 },
  input: {
    background: theme.bg,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    color: theme.textPrimary,
    font: 'inherit',
    padding: '10px 12px',
  },
  status: { color: theme.textSecondary, fontSize: 12, fontWeight: 700 },
  backendBanner: { borderRadius: 8, display: 'grid', gap: 8, padding: '12px 14px' },
  backendBannerHosted: { background: '#14291f', border: '1px solid #166534', color: '#bbf7d0' },
  backendBannerWarn: { background: '#2a2214', border: '1px solid #92400e', color: '#fde68a' },
  watchRow: { display: 'grid', gap: 8, gridTemplateColumns: '1fr auto' },
  watchlist: { display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 },
  watchItem: {
    alignItems: 'center',
    background: theme.bg,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 12px',
  },
  linkButton: {
    background: 'transparent',
    border: 0,
    color: theme.accentSoft,
    cursor: 'pointer',
    fontWeight: 800,
    padding: 0,
  },
  errorText: { color: theme.error, fontSize: 12, margin: 0 },
  segmented: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, 1fr)' },
  segment: {
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontWeight: 900,
    padding: '10px 12px',
  },
  segmentActive: {
    background: 'var(--pulse-accent-strong, #7c3aed)',
    border: '1px solid var(--pulse-accent-soft, #a78bfa)',
    borderRadius: 8,
    color: theme.onAccent,
    cursor: 'pointer',
    fontWeight: 900,
    padding: '10px 12px',
  },
  secondaryButton: {
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    color: theme.textPrimary,
    cursor: 'pointer',
    fontWeight: 900,
    padding: '9px 12px',
  },
  saved: { color: theme.liveSoft, fontWeight: 800 },
  debugActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  debugPre: {
    background: theme.bgCanvas,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    color: theme.textSecondary,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 10,
    lineHeight: 1.45,
    margin: 0,
    maxHeight: 280,
    overflow: 'auto',
    padding: '10px 12px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  footer: {
    borderTop: `1px solid ${theme.border}`,
    marginTop: 28,
    paddingTop: 16,
  },
  footerLink: {
    color: theme.textSecondary,
    fontSize: 13,
    textDecoration: 'underline',
  },
}

createRoot(document.getElementById('root')!).render(<OptionsApp />)
