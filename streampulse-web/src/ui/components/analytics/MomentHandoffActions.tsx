import { useState } from 'react'
import type { FigmaMomentRow } from '../../../lib/figmaSessionAnalytics'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import './moment-inspector-layout.css'

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
  return <>
    <button className="hub-openbtn hub-openbtn--ghost" type="button" aria-label="Copy moment link" onClick={() => void copy()}>Copy link</button>
    {copyMessage ? <span className="moment-inspector-actions__status" role="status">{copyMessage}</span> : null}
  </>
}
