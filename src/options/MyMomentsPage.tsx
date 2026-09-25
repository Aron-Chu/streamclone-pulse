import { useEffect, useMemo, useState } from 'react'
import { LibraryWorkspace } from '../ui/library/LibraryWorkspace.tsx'
import type { LibraryCommand, LibraryRepository } from '../ui/library/model.ts'
import type { MyMomentsCommand, MyMomentsSnapshot } from '../shared/myMoments.ts'

export function createMyMomentsRepository(): LibraryRepository {
  let scope: string | undefined
  async function request(command?: LibraryCommand): Promise<MyMomentsSnapshot> {
    if (command && (!scope || ['interaction', 'create-collection'].includes(command.kind))) throw new Error('This action is unavailable.')
    if (command?.kind === 'save') {
      const { id, channel, title, vodId, streamId, offsetSeconds, availability } = command.reference
      command = { kind: 'save', reference: { id, channel, title, vodId, streamId, offsetSeconds, availability } }
    }
    const result = await chrome.runtime.sendMessage(command
      ? { type: 'MY_MOMENTS', action: 'mutate', scope, command: command as MyMomentsCommand }
      : { type: 'MY_MOMENTS', action: 'load' })
    if (result?.type !== 'MY_MOMENTS' || !result.snapshot?.production) throw new Error('Could not load or save My Moments. Check your device connection and retry.')
    scope = result.snapshot.scope
    return result.snapshot
  }
  return {
    load: () => request(),
    execute: command => request(command),
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
  return <LibraryWorkspace key={revision} repository={repository} onExport={json => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'streampulse-my-moments.json'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }} />
}
