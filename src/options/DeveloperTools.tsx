import { PulseThemedSelect } from '../ui/PulseThemedSelect.tsx'
import { useEffect, useRef, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { backgroundErrorMessage } from '../shared/backgroundResponse.ts'
import {
  DEFAULT_BACKEND_URL,
  DEFAULT_POLL_INTERVAL_MS,
  POLL_INTERVAL_OPTIONS_MS,
  getBackendUrl,
  getPollIntervalMs,
  setBackendUrl,
  setPollIntervalMs,
} from '../shared/storage.ts'
import {
  clearPulseDebugLog,
  getPulseDebugEnabled,
  getPulseDebugLog,
  setPulseDebugEnabled,
  type PulseDebugEntry,
} from '../shared/pulseDebug.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'

export function DeveloperTools() {
  const [backendUrl, setBackendUrlState] = useState(DEFAULT_BACKEND_URL)
  const [pollMs, setPollMsState] = useState(DEFAULT_POLL_INTERVAL_MS)
  const [debugLogging, setDebugLogging] = useState(false)
  const [debugLog, setDebugLog] = useState<PulseDebugEntry[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    void Promise.all([getBackendUrl(), getPollIntervalMs(), getPulseDebugEnabled()]).then(
      ([url, interval, debug]) => {
        setBackendUrlState(url)
        setPollMsState(interval)
        setDebugLogging(debug)
        if (debug) void refreshDebugLog()
      },
    )
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [])

  function showStatus(message: string): void {
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    setStatus(message)
    timerRef.current = window.setTimeout(() => setStatus(''), 2_500)
  }

  async function refreshDebugLog(): Promise<void> {
    setDebugLog(await getPulseDebugLog())
  }

  async function toggleDebugLogging(enabled: boolean): Promise<void> {
    await setPulseDebugEnabled(enabled)
    setDebugLogging(enabled)
    if (enabled) await refreshDebugLog()
    else setDebugLog([])
  }

  async function testAndApply(): Promise<void> {
    setBusy(true)
    const [previousUrl, previousInterval] = await Promise.all([getBackendUrl(), getPollIntervalMs()])
    try {
      await Promise.all([setBackendUrl(backendUrl), setPollIntervalMs(pollMs)])
      const response = await sendBackgroundMessage({ type: 'HEALTH', force: true })
      const failure = backgroundErrorMessage(response, 'backend_test_failed')
      if (failure || !('type' in response) || response.type !== 'HEALTH' || !response.ok) throw new Error(failure ?? 'backend_test_failed')
      showStatus('Developer tools applied')
    } catch {
      await Promise.all([setBackendUrl(previousUrl), setPollIntervalMs(previousInterval)])
      setBackendUrlState(previousUrl)
      setPollMsState(previousInterval)
      showStatus('Test failed; previous settings restored')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-settings-section="developer" data-developer-tools="true" className="pulse-settings-flat-section">
      <PulseSectionCard title="Developer tools" headingLevel={2}>
        <div className="pulse-settings-field">
          <label className="pulse-settings-label" htmlFor="settings-backend-url">Backend URL</label>
          <div className="pulse-settings-input-row">
            <input id="settings-backend-url" className="pulse-settings-input" value={backendUrl} onChange={event => setBackendUrlState(event.target.value)} />
            <button type="button" className="pulse-secondary-btn" onClick={() => setBackendUrlState(DEFAULT_BACKEND_URL)}>Hosted</button>
          </div>
          <span className="pulse-settings-hint">Changes apply only after a successful Test &amp; Apply.</span>
        </div>
        <div className="pulse-settings-field">
          <label className="pulse-settings-label" htmlFor="settings-poll-interval">Polling cadence</label>
          <PulseThemedSelect id="settings-poll-interval" ariaLabel="Polling cadence" value={String(pollMs)} onChange={value => setPollMsState(Number(value))} options={POLL_INTERVAL_OPTIONS_MS.map(value => ({ value: String(value), label: `${value / 1_000}s` }))} />
          <span className="pulse-settings-hint">Supported development cadences: 15, 30, or 60 seconds.</span>
        </div>
        <div className="pulse-settings-toggle-row">
          <div><label className="pulse-settings-label" htmlFor="settings-debug-logging">Debug logging</label><span className="pulse-settings-hint">Stores bounded Pulse troubleshooting events locally.</span></div>
          <input id="settings-debug-logging" type="checkbox" className="pulse-settings-toggle" checked={debugLogging} onChange={event => void toggleDebugLogging(event.target.checked)} />
        </div>
        <div className="pulse-settings-actions-row">
          <button type="button" className="pulse-secondary-btn" disabled={!debugLogging} onClick={() => void refreshDebugLog()}>Refresh log</button>
          <button type="button" className="pulse-secondary-btn" disabled={!debugLogging || debugLog.length === 0} onClick={() => void clearPulseDebugLog().then(refreshDebugLog)}>Clear log</button>
        </div>
        {debugLogging && debugLog.length > 0 ? <pre className="pulse-settings-debug-log">{debugLog.slice(-20).map(entry => `${new Date(entry.ts).toLocaleTimeString()} [${entry.level}] ${entry.step}\n${entry.message}`).join('\n\n')}</pre> : null}
        <div className="pulse-settings-actions-row">
          <button type="button" className="pulse-primary-btn" disabled={busy} onClick={() => void testAndApply()}>{busy ? 'Testing…' : 'Test & Apply'}</button>
          {status ? <span className="pulse-settings-hint" role="status">{status}</span> : null}
        </div>
      </PulseSectionCard>
    </section>
  )
}
