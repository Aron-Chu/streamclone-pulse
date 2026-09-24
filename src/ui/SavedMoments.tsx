import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { displayMomentReasonLabel, formatHeatOffset, reactionAnalyticalOffset, type LiveHeatPoint } from '@streampulse/pulse-core'
import { sendBackgroundMessage } from '../content/bridge.ts'
import type { PulseBookmark } from '../shared/messages.ts'
import { overlayGhostChipButton } from './momentReasonStyles.ts'
import { LibraryIcon } from './library/LibraryIcon.tsx'
import { theme } from './theme.ts'

type SaveProblem = { message: string; connect?: boolean }

function saveProblem(error: unknown): SaveProblem {
  const code = error instanceof Error ? error.message : String(error ?? '')
  if (/account_authorization_required|account_identity_changed/.test(code)) {
    return { message: 'Connect your free Pulse account to bookmark this moment.', connect: true }
  }
  if (code === 'account_hosted_only') return { message: 'Bookmarks are available with the hosted StreamPulse connection.' }
  if (code === 'extension_context_invalidated') return { message: 'The extension was updated. Refresh this Twitch tab to bookmark.' }
  return { message: 'Could not save this moment. Try again.' }
}

const buttonStyle: CSSProperties = {
  ...overlayGhostChipButton, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  gap: 7, minHeight: 40, minWidth: 0, padding: '8px 12px', fontSize: 11, lineHeight: 1.3,
}
const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.16)',
  border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.44)',
  color: 'var(--pulse-accent-ink, #ddd6fe)',
}

/** Free, on-demand bookmarks. Account credentials never leave the worker. */
export function SavedMoments({ login, streamId, vodId, selected }: {
  login: string; streamId?: string; vodId?: string; selected?: LiveHeatPoint | null
}) {
  const [items, setItems] = useState<PulseBookmark[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SaveProblem>()
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const pending = useRef(false)
  const validVodId = vodId && /^\d+$/.test(vodId) ? vodId : undefined
  useEffect(() => {
    const reset = () => {
      generation.current++
      pending.current = false
      setItems([]); setError(undefined); setNotice(''); setBusy(false)
    }
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('pulseAccountRevision' in changes || 'backendUrl' in changes) { reset(); hydrate() }
    }
    reset()
    const storage = globalThis.chrome?.storage?.onChanged
    storage?.addListener(changed)
    let active = true
    function hydrate() {
    const current = generation.current
    if (globalThis.chrome?.runtime?.id && login && (streamId || validVodId)) {
      // Hydration is display-only. A signed-out or offline viewer should still
      // get the bookmark action, so errors here remain silent; the save path
      // gives the actionable account/network message when the user asks to
      // write. Keep the preflight in save() as the final duplicate guard.
      void Promise.resolve(sendBackgroundMessage({
        type: 'LIST_BOOKMARKS',
        login,
        streamId,
        vodId: streamId ? undefined : validVodId,
        contextVodId: validVodId,
        limit: 100,
      })).then(result => {
        if (!active || current !== generation.current || pending.current) return
        if ('error' in result && result.error) return
        if ('type' in result && result.type === 'BOOKMARKS') {
          setItems(previous => {
            const merged = new Map(previous.map(item => [item.id, item]))
            for (const item of result.items) merged.set(item.id, item)
            return [...merged.values()]
          })
        }
      }).catch(() => {
        // The bookmark button remains usable; save() reports failures.
      })
    }
    }
    hydrate()
    return () => { active = false; generation.current++; storage?.removeListener(changed) }
  }, [login, streamId, validVodId])

  const offset = selected ? Math.floor(reactionAnalyticalOffset(selected)) : undefined
  const usableOffset = offset !== undefined && Number.isFinite(offset) && offset >= 0
  const saved = usableOffset && items.some(item => item.offsetSeconds === offset
    && (streamId ? item.streamId === streamId : item.vodId === validVodId))
  const canSave = usableOffset && Boolean(streamId || validVodId)

  async function openSettings(section: 'moments' | 'supporter') {
    const current = generation.current
    try {
      const result = await sendBackgroundMessage({ type: 'OPEN_SETTINGS_HOST', section })
      if ('error' in result && result.error) throw new Error(result.error)
    } catch {
      if (current === generation.current) setError({ message: 'Could not open settings. Try again.' })
    }
  }

  async function save() {
    if (!selected || !canSave || pending.current || saved) return
    const current = generation.current
    pending.current = true
    setBusy(true); setError(undefined); setNotice('')
    try {
      // Check all matching pages so a reload or an uncertain prior response
      // does not create another bookmark for the same timestamp.
      let cursor: string | undefined
      const seen = new Set<string>()
      do {
        const result = await sendBackgroundMessage({ type: 'LIST_BOOKMARKS', login,
          streamId, vodId: streamId ? undefined : validVodId, contextVodId: validVodId,
          limit: 100, ...(cursor ? { cursor } : {}) })
        if (current !== generation.current) return
        if ('error' in result && result.error) throw new Error(result.error)
        if (!('type' in result) || result.type !== 'BOOKMARKS') throw new Error('invalid_bookmark_response')
        const existing = result.items.find(item => item.offsetSeconds === offset
          && (streamId ? item.streamId === streamId : item.vodId === validVodId))
        if (existing) {
          setItems(previous => [...previous.filter(item => item.id !== existing.id), existing])
          setNotice(`Already bookmarked at ${formatHeatOffset(offset)}.`)
          return
        }
        cursor = result.nextCursor
        if (cursor && (seen.has(cursor) || seen.size >= 50)) throw new Error('invalid_bookmark_pagination')
        if (cursor) seen.add(cursor)
      } while (cursor)

      const result = await sendBackgroundMessage({ type: 'SAVE_BOOKMARK', bookmark: {
        login, streamId, ...(validVodId ? { vodId: validVodId } : {}), offsetSeconds: offset,
        label: displayMomentReasonLabel(selected.reason, selected.reasonLabel), source: 'extension',
      } })
      if (current !== generation.current) return
      if ('error' in result && result.error) throw new Error(result.error)
      if (!('type' in result) || result.type !== 'BOOKMARK') throw new Error('invalid_bookmark_response')
      setItems(previous => [result.item, ...previous.filter(item => item.id !== result.item.id)])
      setNotice(`Bookmarked at ${formatHeatOffset(offset)}.`)
    } catch (cause) {
      if (current === generation.current) setError(saveProblem(cause))
    } finally {
      if (current === generation.current) { pending.current = false; setBusy(false) }
    }
  }

  return <section aria-label="Moment bookmarks" aria-busy={busy} style={{ margin: '12px 0 8px', fontSize: 12 }} data-chart-action="true" data-moments-actions="true" onClick={event => event.stopPropagation()}>
    <div className="pulse-moment-actions" style={{
      display: 'grid',
      gap: 8,
      gridTemplateColumns: selected ? 'repeat(auto-fit, minmax(132px, 1fr))' : 'minmax(0, max-content)',
      alignItems: 'stretch',
      justifyContent: 'start',
    }}>
      {selected ? <button style={{ ...(canSave && !saved ? primaryButtonStyle : buttonStyle), width: '100%' }} className={`pulse-action-chip pulse-moment-bookmark-button${canSave && !saved ? ' pulse-action-chip-primary' : ''}`} type="button" disabled={busy || saved || !canSave}
        title={canSave ? `Save this moment at ${formatHeatOffset(offset!)}` : 'A stream or VOD reference is required'}
        aria-label={canSave ? `Save moment at ${formatHeatOffset(offset!)}` : 'Save moment unavailable: a stream or VOD reference is required'}
        data-moment-action="bookmark"
        data-moment-save-state={saved ? 'saved' : busy ? 'saving' : canSave ? 'ready' : 'unavailable'}
        onClick={() => void save()}><span className="pulse-moment-bookmark-icon"><LibraryIcon name={saved ? 'check' : 'bookmark'} /></span>{saved ? 'Bookmarked' : busy ? 'Saving...' : 'Bookmark'}</button> : null}
      <button
        style={{ ...buttonStyle, width: selected ? '100%' : undefined }}
        className="pulse-action-chip"
        type="button"
        title="Open your saved moments, notes, and watched history"
        aria-label="Open My Moments"
        data-moment-action="open-library"
        onClick={() => void openSettings('moments')}
      >
        <LibraryIcon name="bookmark" />View My Moments
      </button>
    </div>
    <p className="pulse-moment-actions-copy" style={{ margin: '7px 0 0', color: theme.textMuted, fontSize: 10, lineHeight: 1.4 }}>
      Free to use. Bookmarks sync with your Pulse account.
    </p>
    {notice ? <p className="pulse-moment-action-feedback" role="status" style={{ margin: '6px 0 0', color: theme.textSecondary }}>{notice}</p> : null}
    {error ? <div className="pulse-moment-action-error" role="alert" style={{ marginTop: 6, display: 'grid', gap: 6 }}>
      <span>{error.message}</span>
      {error.connect ? <button style={{ ...primaryButtonStyle, justifySelf: 'start' }} className="pulse-action-chip pulse-action-chip-primary" type="button" data-moment-action="connect-account" onClick={() => void openSettings('supporter')}>Connect free account</button> : null}
    </div> : null}
  </section>
}
