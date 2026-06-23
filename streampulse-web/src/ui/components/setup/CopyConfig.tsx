import { useState } from 'react'
import { buildCopyConfig } from '../../../lib/health'

interface CopyConfigProps {
  backendUrl: string
  betaKey: string
  pollIntervalMs?: number
  label?: string
}

export function CopyConfig({
  backendUrl,
  betaKey,
  pollIntervalMs,
  label = 'Copy config',
}: CopyConfigProps) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCopy(): Promise<void> {
    setError(null)
    const payload = buildCopyConfig({ backendUrl, betaKey, pollIntervalMs })
    const text = JSON.stringify(payload, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy to clipboard.')
    }
  }

  return (
    <div className="stack-sm">
      <button type="button" className="btn btn-secondary" onClick={() => void handleCopy()}>
        {copied ? 'Copied ✓' : label}
      </button>
      {error ? <p className="alert alert-error">{error}</p> : null}
    </div>
  )
}
