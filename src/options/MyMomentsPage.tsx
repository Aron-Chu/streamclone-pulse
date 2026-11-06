import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LibraryWorkspace } from '../ui/library/LibraryWorkspace.tsx'
import type { LibraryCommand, LibraryMoment, LibraryRepository, LibraryView, MomentReference } from '../ui/library/model.ts'
import type { MomentContext, MomentContextState } from '../ui/library/MomentPreview.tsx'
import { MY_MOMENTS_CHANGED, type MyMomentsCommand, type MyMomentsSnapshot } from '../shared/myMoments.ts'
import { usePortalOrigin } from './usePortalOrigin.ts'
import type { MomentPresentation } from '../ui/library/MomentMedia.tsx'
import { momentIdentity } from '../background/myMomentsStore.ts'
import { momentPictures, type SavedPicture } from '../shared/momentPictureStore.ts'
import { getMomentPicturesEnabled } from '../shared/storage.ts'

/** Only a reference's own fields cross to the worker: a row's note, dates and other enrichment stay here. */
function reference(r: MomentReference): MomentReference {
  const { id, channel, title, vodId, streamId, offsetSeconds, vodOriginDeltaSeconds, availability } = r
  return { id, channel, title, vodId, streamId, offsetSeconds, ...(vodOriginDeltaSeconds === undefined ? {} : { vodOriginDeltaSeconds }), availability }
}
/** Worker sentences written for people; anything else is told in one of the lines below. */
const WORKER_SENTENCE = /^(My Moments is|Device connection|Your Pulse account|Added \d|Could not add to your account|Sign in|Connect a Pulse|Bookmark unavailable|That save|Synced History)/
/**
 * What failed, in words (F9): a full browser, StreamPulse out of reach, or a
 * change or load that did not go through. Never "check your connection" when
 * the connection was fine.
 */
export function myMomentsProblem(raw: unknown, change: boolean): string {
  const text = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : ''
  if (/allowance|quota/i.test(text)) return 'This browser’s storage is full. Remove or export some saves.'
  if (WORKER_SENTENCE.test(text)) return text
  if (/reach StreamPulse|extension_api_|fetch|network|timeout|account_temporarily_unavailable|\b5\d\d\b/i.test(text)) return 'Couldn’t reach StreamPulse. Your saves on this browser are safe.'
  return change ? 'Couldn’t save that. Try again.' : 'Couldn’t load your moments. Try again.'
}
export function createMyMomentsRepository(): LibraryRepository {
  let scope: string | undefined
  async function request(command?: LibraryCommand): Promise<MyMomentsSnapshot> {
    if (command && (!scope || ['interaction', 'create-collection'].includes(command.kind))) throw new Error('This action is unavailable.')
    if (command?.kind === 'save' || command?.kind === 'remove-visit') command = { ...command, reference: reference(command.reference) }
    if (command?.kind === 'restore-visit') command = { ...command, reference: reference(command.reference) }
    let result: { type?: string; snapshot?: MyMomentsSnapshot; error?: unknown } | undefined
    try {
      result = await chrome.runtime.sendMessage(command
        ? { type: 'MY_MOMENTS', action: 'mutate', scope, command: command as MyMomentsCommand }
        : { type: 'MY_MOMENTS', action: 'load' })
    } catch (error) { throw new Error(myMomentsProblem(error, !!command)) }
    if (result?.type !== 'MY_MOMENTS' || !result.snapshot?.production) throw new Error(myMomentsProblem(result?.error, !!command))
    scope = result.snapshot.scope
    return result.snapshot
  }
  return {
    load: () => request(),
    execute: command => request(command),
    subscribe: onChange => {
      // Only the worker says so; a Twitch tab's content script carries a tab.
      const heard = (message: unknown, sender: chrome.runtime.MessageSender) => {
        if ((message as { type?: unknown } | null)?.type === MY_MOMENTS_CHANGED && !sender.tab) onChange()
      }
      chrome.runtime.onMessage.addListener(heard)
      return () => chrome.runtime.onMessage.removeListener(heard)
    },
    export: async () => {
      const snapshot = await request()
      const bookmarksState = snapshot.bookmarksState
        ?? (snapshot.bookmarksAvailable ? 'ready' : 'error')
      const { scope: _scope, ...data } = snapshot
      return JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        exportScope: bookmarksState === 'ready' ? 'complete' : 'device-local',
        cloudBookmarks: bookmarksState === 'ready' ? 'included' : 'not-included',
        ...data,
      }, null, 2)
    },
  }
}
export function MyMomentsPage() {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (Object.keys(changes).some(k => k.startsWith('deviceCredential:') || k === 'backendUrl' || k === 'pulseAccountRevision')) setRevision(v => v + 1)
    }
    chrome.storage.onChanged.addListener(changed)
    return () => chrome.storage.onChanged.removeListener(changed)
  }, [])
  const repository = useMemo(createMyMomentsRepository, [revision])
  return <MyMomentsWorkspace key={revision} repository={repository} />
}

/** Asks the worker for one moment's minute; any failure is simply "no stats". */
async function readMomentMinute(streamId: string, offsetSeconds: number): Promise<MomentContext | null> {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'MOMENT_MINUTE', streamId, offsetSeconds })
    return result?.type === 'MOMENT_MINUTE' && result.context ? result.context as MomentContext : null
  } catch { return null }
}

/**
 * Preview's chat, emotes and viewers for the moments a list page shows. A
 * bookmark keeps only a label, so each moment's minute is read once from the
 * public minutes API by stream id and offset when its page is listed. Moments
 * that share a minute share the read. A moment without a stream id has none.
 */
function useMomentMinutes() {
  const [contexts, setContexts] = useState<Record<string, MomentContextState>>({})
  const reads = useRef(new Map<string, Promise<MomentContext | null>>())
  const asked = useRef(new Set<string>())
  const show = useCallback((moments: readonly LibraryMoment[]) => {
    const wanted = moments.filter(moment => !asked.current.has(moment.id) && /^\d{1,20}$/.test(moment.streamId ?? '')
      && moment.offsetSeconds !== null && Number.isFinite(moment.offsetSeconds) && moment.offsetSeconds >= 0)
    if (!wanted.length) return
    setContexts(current => ({ ...current, ...Object.fromEntries(wanted.map(moment => [moment.id, { kind: 'loading' } as const])) }))
    for (const moment of wanted) {
      asked.current.add(moment.id)
      const streamId = moment.streamId!, offsetSeconds = Math.floor(moment.offsetSeconds!)
      const key = `${streamId}|${offsetSeconds}`
      let read = reads.current.get(key)
      if (!read) { read = readMomentMinute(streamId, offsetSeconds); reads.current.set(key, read) }
      void read.then(context => setContexts(current => ({ ...current,
        [moment.id]: context ? { kind: 'ready', value: context } : { kind: 'unavailable', reason: 'No measured minute for this moment.' } })))
    }
  }, [])
  return { contexts, show }
}

/**
 * Pictures kept on this device with the moments a list page shows: the frame
 * a Twitch tab held when the moment was saved or watched. Read when the page
 * lists them; their object URLs go when the page closes. A moment that had
 * none is looked up again the next time it is listed.
 */
function useSavedPictures() {
  const [presentations, setPresentations] = useState<Record<string, MomentPresentation>>({})
  const found = useRef(new Set<string>())
  // Pictures this page has shown. A bookmark removed and brought back by Undo
  // lost its picture with it; this puts it back. Account changes remount the page.
  const held = useRef(new Map<string, SavedPicture>())
  const urls = useRef<string[]>([])
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url) }, [])
  const show = useCallback((moments: readonly LibraryMoment[]) => {
    const wanted = moments.filter(moment => moment.offsetSeconds !== null && (!found.current.has(moment.id) || held.current.has(momentIdentity(moment))))
    if (!wanted.length) return
    void momentPictures.forMoments(wanted.map(momentIdentity)).then(async pictures => {
      const lost = [...new Set(wanted.map(momentIdentity))].filter(identity => !pictures.has(identity) && held.current.has(identity))
      if (lost.length && await getMomentPicturesEnabled()) for (const identity of lost) {
        const picture = held.current.get(identity)!
        await momentPictures.attach(picture.scope, identity, picture.image, picture.offset, picture.savedAt)
        // The cap may take it straight back out; then it stays gone.
        if (await momentPictures.has(picture.scope, identity)) pictures.set(identity, picture)
        else held.current.delete(identity)
      }
      const next: Record<string, MomentPresentation> = {}
      for (const moment of wanted) {
        const picture = pictures.get(momentIdentity(moment))
        if (picture) held.current.set(picture.identity, picture)
        if (!picture || found.current.has(moment.id)) continue
        found.current.add(moment.id)
        const url = URL.createObjectURL(picture.image)
        urls.current.push(url)
        next[moment.id] = { image: { url, sampledOffsetSeconds: picture.offset } }
      }
      if (Object.keys(next).length) setPresentations(current => ({ ...current, ...next }))
    }).catch(() => undefined)
  }, [])
  return { presentations, show }
}

function MyMomentsWorkspace({ repository }: { repository: LibraryRepository }) {
  // Analytics links follow the configured API (a local backend opens the local
  // portal), like every other product link here. Keyed by revision above, so a
  // backend switch re-reads the origin.
  const analyticsOrigin = usePortalOrigin()
  const minutes = useMomentMinutes()
  const pictures = useSavedPictures()
  const showMoments = useCallback((moments: readonly LibraryMoment[]) => {
    minutes.show(moments)
    pictures.show(moments)
  }, [minutes.show, pictures.show])
  // The panel's View after a jump that joined History opens on History.
  const [initialView] = useState<LibraryView>(() => location.hash === '#moments-history' ? 'recent' : 'saved')
  return <LibraryWorkspace repository={repository} initialView={initialView} analyticsOrigin={analyticsOrigin} previewContexts={minutes.contexts} presentations={pictures.presentations}
    onShowMoments={showMoments} onExport={json => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'streampulse-my-moments.json'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }} />
}
