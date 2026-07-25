import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  DEFAULT_AUTO_TRACK_POLICY,
  DEFAULT_BACKEND_URL,
  DEFAULT_DEFAULT_CHART_WINDOW,
  DEFAULT_OVERLAY_PLACEMENT,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_THEME_PREFERENCE,
  POLL_INTERVAL_OPTIONS_MS,
  getAutoTrackPolicy,
  getBackendUrl,
  getChatClosedPulseDockEnabled,
  getDefaultChartWindow,
  getOverlayPlacement,
  getPollIntervalMs,
  getThemePreference,
  isLocalStackBackendUrl,
  migrateDefaultChartWindowToRecentV2Once,
  setAutoTrackPolicy,
  setBackendUrl,
  setChatClosedPulseDockEnabled,
  setDefaultChartWindow,
  setOverlayPlacement,
  setPollIntervalMs,
  setThemePreference,
  type AutoTrackPolicy,
  type DefaultChartWindow,
  type OverlayPlacement,
  type ThemePreference,
} from '../shared/storage.ts'
import {
  extensionBackendSourceCaption,
  resolveExtensionBackendSource,
} from '../shared/backendSource.ts'
import { ACCENT_THEME_OPTIONS, applyAccentTheme } from '../ui/overlayTheme.ts'
import { normalizeLogin } from '../shared/login.ts'
import {
  clearPulseDebugLog,
  getPulseDebugEnabled,
  getPulseDebugLog,
  initPulseDebug,
  setPulseDebugEnabled,
  type PulseDebugEntry,
} from '../shared/pulseDebug.ts'

function OptionsApp() {
  const [backendUrl, setBackendUrlState] = useState(DEFAULT_BACKEND_URL)
  const [pollMs, setPollMsState] = useState(DEFAULT_POLL_INTERVAL_MS)
  const [placement, setPlacementState] = useState<OverlayPlacement>(DEFAULT_OVERLAY_PLACEMENT)
  const [chatClosedDockEnabled, setChatClosedDockEnabledState] = useState(false)
  const [autoTrackPolicy, setAutoTrackPolicyState] = useState<AutoTrackPolicy>(DEFAULT_AUTO_TRACK_POLICY)
  const [themePref, setThemePrefState] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE)
  const [chartWindow, setChartWindowState] = useState<DefaultChartWindow>(DEFAULT_DEFAULT_CHART_WINDOW)
  const [watchlist, setWatchlistState] = useState<string[]>([])
  const [channelInput, setChannelInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [health, setHealth] = useState('Not checked')
  const [watchlistError, setWatchlistError] = useState('')
  const [debugLogging, setDebugLogging] = useState(false)
  const [debugLog, setDebugLog] = useState<PulseDebugEntry[]>([])
  const [debugCopied, setDebugCopied] = useState(false)
  const localStackBackend = isLocalStackBackendUrl(backendUrl)
  const backendSource = resolveExtensionBackendSource(backendUrl)
  const hostedBackend = backendSource === 'hosted'

  useEffect(() => {
    void (async () => {
      await initPulseDebug()
      setBackendUrlState(await getBackendUrl())
      setPollMsState(await getPollIntervalMs())
      setPlacementState(await getOverlayPlacement())
      setChatClosedDockEnabledState(await getChatClosedPulseDockEnabled())
      setAutoTrackPolicyState(await getAutoTrackPolicy())
      const storedTheme = await getThemePreference()
      setThemePrefState(storedTheme)
      applyAccentTheme(storedTheme)
      await migrateDefaultChartWindowToRecentV2Once()
      setChartWindowState(await getDefaultChartWindow())
      setDebugLogging(await getPulseDebugEnabled())
      await refreshWatchlist()
      await refreshDebugLog()
    })()
  }, [])

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

  async function save(): Promise<void> {
    await Promise.all([
      setBackendUrl(backendUrl),
      setPollIntervalMs(pollMs),
      setOverlayPlacement(placement),
      setChatClosedPulseDockEnabled(chatClosedDockEnabled),
      setAutoTrackPolicy(autoTrackPolicy),
      setThemePreference(themePref),
      setDefaultChartWindow(chartWindow),
    ])
    applyAccentTheme(themePref)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    await probeHealth()
    await sendBackgroundMessage({ type: 'SYNC_WATCHLIST' })
    await refreshWatchlist()
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
          <h1 style={styles.title}>StreamPulse</h1>
          <p style={styles.lead}>Configure the overlay and manage channels Streamclone should keep in its tracking pool.</p>
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
              }}
            >
              Reset to hosted API
            </button>
          ) : null}
        </div>
        <label style={styles.label}>
          <span>Backend URL</span>
          <input value={backendUrl} onChange={e => setBackendUrlState(e.target.value)} placeholder={DEFAULT_BACKEND_URL} style={styles.input} />
        </label>
        <div style={styles.status}>{health}</div>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Watchlist / Protect</span>
        <p style={styles.help}>
          Saved channels are stored in <strong>Chrome sync</strong> on this device. On the public hosted API there is
          no guest Protect credential, so the extension does <strong>not</strong> claim server-side protection and
          does not enable live Pulse or backfill. Use the <strong>Analytics hub</strong> to browse actively tracked
          channels. On a <strong>local</strong> backend (<code>localhost:8081</code>), watchlist entries also start
          IRC while your stack runs.
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
            No channels yet. On hosted, adding a login saves a local Chrome-sync preference only — it does not claim
            server-side Protect.
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
        <span style={styles.groupLabel}>Accent theme</span>
        <p style={styles.help}>Recolors Pulse sidebar accents. Matches the in-overlay Settings picker.</p>
        <div style={styles.swatchRow}>
          {ACCENT_THEME_OPTIONS.map(option => {
            const active = themePref === option.value
            return (
              <button
                key={option.value}
                type="button"
                style={{
                  ...styles.swatch,
                  ...(active ? styles.swatchActive : null),
                }}
                onClick={() => {
                  setThemePrefState(option.value)
                  applyAccentTheme(option.value)
                }}
              >
                <span style={{ ...styles.swatchDot, background: option.swatch }} />
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Default chart window</span>
        <div style={styles.segmented}>
          {(['15m', '30m', '60m', '2h', '4h', 'full'] as const).map(value => (
            <button
              key={value}
              type="button"
              style={chartWindow === value ? styles.segmentActive : styles.segment}
              onClick={() => setChartWindowState(value)}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>
        <p style={styles.help}>
          Full is remembered as a preference but must be loaded with “Load full history” for each new stream activation. Live polling always uses a recent window.
        </p>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Polling interval</span>
        <div style={styles.segmented}>
          {POLL_INTERVAL_OPTIONS_MS.map(value => (
            <button
              key={value}
              type="button"
              style={pollMs === value ? styles.segmentActive : styles.segment}
              onClick={() => setPollMsState(value)}
            >
              {value / 1000}s
            </button>
          ))}
        </div>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Chat-closed dock</span>
        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={chatClosedDockEnabled}
            onChange={event => setChatClosedDockEnabledState(event.target.checked)}
          />
          Show Pulse dock when chat is closed
        </label>
        <p style={styles.help}>
          CHAT/PULSE tabs always show when Twitch chat is open. This option adds a bottom-right Pulse panel only when the chat column is hidden.
        </p>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Overlay placement</span>
        <select
          value={placement}
          onChange={e => setPlacementState(e.target.value as OverlayPlacement)}
          style={styles.input}
        >
          <option value="sidebar">Sidebar tab (snap to chat) — recommended</option>
          <option value="right">Right dock</option>
          <option value="bottom">Bottom bar</option>
          <option value="hidden">Hidden</option>
        </select>
        <p style={styles.help}>
          Sidebar tab overlays Pulse on Twitch&apos;s chat column with a Chat | Pulse toggle in a top chrome bar. The panel covers only the message area so gift headers stay clickable.
        </p>
        <p style={styles.help}>
          Using the <strong>7TV</strong> browser extension too? Choose <strong>Chat</strong> in the Pulse chrome bar for normal Twitch chat with 7TV emotes; choose <strong>Pulse</strong> for Streamclone analytics. See{' '}
          <a href="../docs/pulse-extension/README.md" style={styles.docLink}>docs/pulse-extension/README.md</a> for coexistence notes.
        </p>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Auto-track on Twitch</span>
        <select
          value={autoTrackPolicy}
          onChange={e => setAutoTrackPolicyState(e.target.value as AutoTrackPolicy)}
          style={styles.input}
          disabled={!localStackBackend}
        >
          <option value="off">Manual only — use Track channel in the overlay (local stack)</option>
          <option value="followed">Track the channel page you open (local stack only)</option>
          <option value="ask">Ask before tracking (watchlist still auto-tracks on local stack)</option>
        </select>
        <p style={styles.help}>
          Only applies when backend URL is your local Streamclone stack. On hosted (
          <code>api.streampulse.stream</code>), IRC is managed by the top live pool — this control is ignored.
        </p>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Stream Pulse sidebar</span>
        <p style={styles.help}>
          The Pulse sidebar matches Streamclone web Channel → Stream Pulse: chat-only sparkline (last 60 minutes), metrics row, and client-side Most Reacted ranking. Multi-layer analytics charts live on the full Streamclone analytics page — use <strong>Open full analytics →</strong> in the overlay.
        </p>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Debug logging (VOD / backfill)</span>
        <p style={styles.help}>
          Turn on to record step-by-step VOD discovery, Helix health, pulse API, and backfill results. Use this when
          &quot;Waiting for Twitch VOD…&quot; or &quot;Check for VOD &amp; load from start&quot; fails — the log shows exactly which step blocked.
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
            <p style={styles.help}>No entries yet. Open a live channel, expand Pulse, then use &quot;Check for VOD &amp; load from start&quot;.</p>
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

      <button type="button" onClick={() => void save()} style={styles.primaryButton}>Save settings</button>
      {saved ? <p style={styles.saved}>Saved locally.</p> : null}
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { background: '#111118', color: '#fafafc', fontFamily: 'Inter, system-ui, sans-serif', margin: 0, minHeight: '100vh', padding: 24, width: 620 },
  header: { alignItems: 'flex-start', display: 'flex', gap: 16, justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 22, margin: '0 0 6px' },
  lead: { color: '#a1a1b2', fontSize: 13, lineHeight: 1.45, margin: 0, maxWidth: 460 },
  section: { borderTop: '1px solid #30303a', display: 'grid', gap: 10, padding: '16px 0' },
  label: { display: 'grid', gap: 8, fontSize: 13, fontWeight: 800 },
  groupLabel: { color: '#a1a1b2', fontSize: 12, fontWeight: 900, textTransform: 'uppercase' },
  fieldLabel: { color: '#c7c7d4', fontSize: 12, fontWeight: 800 },
  checkboxRow: { alignItems: 'center', display: 'flex', fontSize: 13, fontWeight: 700, gap: 8 },
  help: { color: '#8b8ba0', fontSize: 12, lineHeight: 1.45, margin: 0 },
  input: { background: '#181820', border: '1px solid #3f3f50', borderRadius: 8, color: '#fafafc', font: 'inherit', padding: '10px 12px' },
  status: { color: '#a1a1b2', fontSize: 12, fontWeight: 700 },
  backendBanner: { borderRadius: 8, display: 'grid', gap: 8, padding: '12px 14px' },
  backendBannerHosted: { background: '#14291f', border: '1px solid #166534', color: '#bbf7d0' },
  backendBannerWarn: { background: '#2a2214', border: '1px solid #92400e', color: '#fde68a' },
  watchRow: { display: 'grid', gap: 8, gridTemplateColumns: '1fr auto' },
  watchlist: { display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 },
  watchItem: { alignItems: 'center', background: '#181820', border: '1px solid #30303a', borderRadius: 8, display: 'flex', justifyContent: 'space-between', padding: '10px 12px' },
  linkButton: { background: 'transparent', border: 0, color: '#c4b5fd', cursor: 'pointer', fontWeight: 800, padding: 0 },
  errorText: { color: '#fca5a5', fontSize: 12, margin: 0 },
  segmented: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, 1fr)' },
  swatchRow: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  swatch: {
    alignItems: 'center',
    background: '#20202a',
    border: '1px solid #3f3f50',
    borderRadius: 10,
    color: '#c7c7d4',
    cursor: 'pointer',
    display: 'grid',
    fontSize: 12,
    fontWeight: 800,
    gap: 6,
    justifyItems: 'center',
    padding: '10px 8px',
  },
  swatchActive: { borderColor: '#a78bfa', boxShadow: 'inset 0 0 0 1px rgba(167, 139, 250, 0.45)' },
  swatchDot: { borderRadius: 999, display: 'block', height: 18, width: 18 },
  segment: { background: '#20202a', border: '1px solid #3f3f50', borderRadius: 8, color: '#c7c7d4', cursor: 'pointer', fontWeight: 900, padding: '10px 12px' },
  segmentActive: { background: '#7c3aed', border: '1px solid #a78bfa', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 900, padding: '10px 12px' },
  primaryButton: { background: '#8b5cf6', border: 0, borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 900, padding: '12px 14px' },
  secondaryButton: { background: '#20202a', border: '1px solid #3f3f50', borderRadius: 8, color: '#fafafc', cursor: 'pointer', fontWeight: 900, padding: '9px 12px' },
  saved: { color: '#86efac', fontWeight: 800 },
  docLink: { color: '#c4b5fd' },
  debugActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  debugPre: {
    background: '#0d0d12',
    border: '1px solid #30303a',
    borderRadius: 8,
    color: '#d4d4e0',
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
}

createRoot(document.getElementById('root')!).render(<OptionsApp />)
