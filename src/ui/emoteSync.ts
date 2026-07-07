import type { EmoteSyncSnapshot } from '../shared/messages.ts'

export function emoteSyncStatusLabel(sync?: EmoteSyncSnapshot): string | undefined {
  if (!sync?.message) return undefined
  return sync.message
}

export function emoteSyncStatusTone(sync?: EmoteSyncSnapshot): 'ok' | 'warn' | 'muted' {
  switch (sync?.state) {
    case 'ready':
      return 'ok'
    case 'syncing':
    case 'stale':
      return 'warn'
    default:
      return 'muted'
  }
}

export function emoteSyncDotColor(tone: 'ok' | 'warn' | 'muted'): string {
  if (tone === 'ok') return '#34d399'
  if (tone === 'warn') return '#f97316'
  return '#6b7280'
}
