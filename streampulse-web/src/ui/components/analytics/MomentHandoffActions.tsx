import { useState } from 'react'
import type { FigmaMomentRow } from '../../../lib/figmaSessionAnalytics'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'

export function MomentHandoffActions({ moment }: { moment: FigmaMomentRow }) {
  const [copyMessage, setCopyMessage] = useState('')
  const canonicalPath = moment.login?.trim() && moment.streamId?.trim()
    ? buildAnalyticsHref({ login: moment.login, streamId: moment.streamId, offsetSeconds: moment.offsetSeconds }) : null
  async function copy() {
    if (!canonicalPath) return
    const url = new URL(canonicalPath, 'https://streampulse.stream').href
    try { await navigator.clipboard.writeText(url); setCopyMessage('Moment link copied') }
    catch { setCopyMessage(`Copy this link: ${url}`) }
  }
  if (!canonicalPath) return null
  return <div className="moment-handoff-actions">
    <button className="hub-openbtn hub-openbtn--ghost" type="button" onClick={() => void copy()}>Copy moment link</button>
    <span role="status">{copyMessage}</span>
  </div>
}
