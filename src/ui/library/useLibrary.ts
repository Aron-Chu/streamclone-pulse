import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryCommand, LibraryRepository, LibrarySnapshot } from './model.ts'

export function useLibrary(repository: LibraryRepository) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const session = useRef<AbortController | null>(null)
  const locked = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    session.current = controller
    locked.current = false
    setSnapshot(null); setLoading(true); setBusy(false); setError(null); setNotice('')
    repository.load(controller.signal).then(value => {
      if (!controller.signal.aborted) setSnapshot(value)
    }).catch(() => {
      if (!controller.signal.aborted) setError('Could not load your Library. Nothing has been changed.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [repository, reload])
  const run = useCallback(async (command: LibraryCommand, message: string): Promise<boolean> => {
    const controller = session.current
    if (!controller || controller.signal.aborted || locked.current) return false
    locked.current = true; setBusy(true); setError(null); setNotice('')
    try {
      const next = await repository.execute(command, controller.signal)
      if (controller.signal.aborted) return false
      setSnapshot(next); setNotice(message); return true
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Change could not be saved. Try again.')
      return false
    } finally {
      if (!controller.signal.aborted) { locked.current = false; setBusy(false) }
    }
  }, [repository])
  const exportData = useCallback(async (): Promise<string | null> => {
    const controller = session.current
    if (!controller || locked.current || controller.signal.aborted) return null
    locked.current = true; setBusy(true); setError(null)
    try { const data = await repository.export(controller.signal); return controller.signal.aborted ? null : data }
    catch { if (!controller.signal.aborted) setError('Export failed. Your Library has not been changed.'); return null }
    finally { if (!controller.signal.aborted) { locked.current = false; setBusy(false) } }
  }, [repository])
  return { snapshot, loading, busy, error, notice, run, exportData, retry: () => setReload(v => v + 1) }
}
