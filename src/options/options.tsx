import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  DEFAULT_AUTO_TRACK_POLICY,
  DEFAULT_BACKEND_URL,
  DEFAULT_OVERLAY_PLACEMENT,
  DEFAULT_POLL_INTERVAL_MS,
  POLL_INTERVAL_OPTIONS_MS,
  getAutoTrackPolicy,
  getBackendUrl,
  getOverlayPlacement,
  getPollIntervalMs,
  setAutoTrackPolicy,
  setBackendUrl,
  setOverlayPlacement,
  setPollIntervalMs,
  type AutoTrackPolicy,
  type OverlayPlacement,
} from '../shared/storage.ts'
import { normalizeLogin } from '../shared/login.ts'

function OptionsApp() {
  const [backendUrl, setBackendUrlState] = useState(DEFAULT_BACKEND_URL)
  const [pollMs, setPollMsState] = useState(DEFAULT_POLL_INTERVAL_MS)
  const [placement, setPlacementState] = useState<OverlayPlacement>(DEFAULT_OVERLAY_PLACEMENT)
  const [autoTrackPolicy, setAutoTrackPolicyState] = useState<AutoTrackPolicy>(DEFAULT_AUTO_TRACK_POLICY)
  const [watchlist, setWatchlistState] = useState<string[]>([])
  const [channelInput, setChannelInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [health, setHealth] = useState('Not checked')
  const [watchlistError, setWatchlistError] = useState('')

  useEffect(() => {
    void (async () => {
      setBackendUrlState(await getBackendUrl())
      setPollMsState(await getPollIntervalMs())
      setPlacementState(await getOverlayPlacement())
      setAutoTrackPolicyState(await getAutoTrackPolicy())
      await refreshWatchlist()
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
      setAutoTrackPolicy(autoTrackPolicy),
    ])
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    await probeHealth()
    await sendBackgroundMessage({ type: 'SYNC_WATCHLIST' })
    await refreshWatchlist()
  }

  async function probeHealth(): Promise<void> {
    setHealth('Checking...')
    try {
      const res = await sendBackgroundMessage({ type: 'HEALTH' })
      setHealth('type' in res && res.type === 'HEALTH' && res.ok ? `Backend OK (${res.version ?? 'dev'})` : 'Backend unreachable')
    } catch {
      setHealth('Backend unreachable')
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
          <h1 style={styles.title}>Streamclone Pulse</h1>
          <p style={styles.lead}>Configure the overlay and manage channels Streamclone should keep in its tracking pool.</p>
        </div>
        <button type="button" style={styles.secondaryButton} onClick={() => void probeHealth()}>Probe backend</button>
      </header>

      <section style={styles.section}>
        <label style={styles.label}>
          <span>Backend URL</span>
          <input value={backendUrl} onChange={e => setBackendUrlState(e.target.value)} placeholder={DEFAULT_BACKEND_URL} style={styles.input} />
        </label>
        <div style={styles.status}>{health}</div>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Watchlist</span>
        <p style={styles.help}>
          Channels here are synced to Streamclone always-tracked and polled in the background, even when you are not on their Twitch page.
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
          <p style={styles.help}>No watchlist channels yet. Add logins to track them 24/7 while your local stack is running.</p>
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
              onClick={() => setPollMsState(value)}
            >
              {value / 1000}s
            </button>
          ))}
        </div>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Overlay placement</span>
        <select value={placement} onChange={e => setPlacementState(e.target.value as OverlayPlacement)} style={styles.input}>
          <option value="sidebar">Sidebar tab (snap to chat) — recommended</option>
          <option value="right">Right dock</option>
          <option value="bottom">Bottom bar</option>
          <option value="hidden">Hidden</option>
        </select>
        <p style={styles.help}>
          Sidebar tab overlays Pulse on Twitch&apos;s chat column with a Chat | Pulse toggle in a top chrome bar. The panel covers only the message area so gift headers stay clickable. If chat is popped out or hidden, Pulse falls back to the right dock.
        </p>
        <p style={styles.help}>
          Using the <strong>7TV</strong> browser extension too? Choose <strong>Chat</strong> in the Pulse chrome bar for normal Twitch chat with 7TV emotes; choose <strong>Pulse</strong> for Streamclone analytics. See{' '}
          <a href="../docs/pulse-extension/README.md" style={styles.docLink}>docs/pulse-extension/README.md</a> for coexistence notes.
        </p>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Auto-track on Twitch</span>
        <select value={autoTrackPolicy} onChange={e => setAutoTrackPolicyState(e.target.value as AutoTrackPolicy)} style={styles.input}>
          <option value="followed">Track the channel page you open</option>
          <option value="ask">Ask before tracking (watchlist still auto-tracks)</option>
          <option value="off">Manual only — use Track channel in the overlay</option>
        </select>
      </section>

      <section style={styles.section}>
        <span style={styles.groupLabel}>Stream Pulse sidebar</span>
        <p style={styles.help}>
          The Pulse sidebar matches Streamclone web Channel → Stream Pulse: chat-only sparkline (last 60 minutes), metrics row, and client-side Most Reacted ranking. Multi-layer analytics charts live on the full Streamclone analytics page — use <strong>Open full analytics →</strong> in the overlay.
        </p>
      </section>

      <button type="button" onClick={() => void save()} style={styles.primaryButton}>Save settings</button>
      {saved ? <p style={styles.saved}>Saved and watchlist synced.</p> : null}
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
  watchRow: { display: 'grid', gap: 8, gridTemplateColumns: '1fr auto' },
  watchlist: { display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 },
  watchItem: { alignItems: 'center', background: '#181820', border: '1px solid #30303a', borderRadius: 8, display: 'flex', justifyContent: 'space-between', padding: '10px 12px' },
  linkButton: { background: 'transparent', border: 0, color: '#c4b5fd', cursor: 'pointer', fontWeight: 800, padding: 0 },
  errorText: { color: '#fca5a5', fontSize: 12, margin: 0 },
  segmented: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, 1fr)' },
  segment: { background: '#20202a', border: '1px solid #3f3f50', borderRadius: 8, color: '#c7c7d4', cursor: 'pointer', fontWeight: 900, padding: '10px 12px' },
  segmentActive: { background: '#7c3aed', border: '1px solid #a78bfa', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 900, padding: '10px 12px' },
  primaryButton: { background: '#8b5cf6', border: 0, borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 900, padding: '12px 14px' },
  secondaryButton: { background: '#20202a', border: '1px solid #3f3f50', borderRadius: 8, color: '#fafafc', cursor: 'pointer', fontWeight: 900, padding: '9px 12px' },
  saved: { color: '#86efac', fontWeight: 800 },
  docLink: { color: '#c4b5fd' },
}

createRoot(document.getElementById('root')!).render(<OptionsApp />)
