import { useId, useRef, useState } from 'react'
import { LibraryDialog, MomentSaveButton } from './LibraryPrimitives.tsx'
import { LibraryIcon } from './LibraryIcon.tsx'
import { replayUrl, timestamp, type LibraryMoment, type MomentReference } from './model.ts'
import { MomentMedia, MomentSignal, safePresentationUrl, type MomentPresentation } from './MomentMedia.tsx'
import { MomentStats, MomentEmotes } from './MomentStats.tsx'

/** Display-only backend projection. This view never derives a Pulse score or sentiment. */
export interface MomentContext {
  provenance: 'fixture' | 'snapshot'
  capturedAt: number
  coverage: 'complete' | 'partial'
  windowLabel: string
  samples: readonly { offsetSeconds: number; messages: number | null }[]
  selectedMessages: number | null
  selectedEmotes: number | null
  selectedViewers?: number | null
  topEmotes: readonly { name: string; count: number; provider?: '7TV' | 'Twitch' | 'BTTV' | 'FFZ'; staticImageUrl?: string }[]
}
export type MomentContextState =
  | { kind: 'ready'; value: MomentContext }
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: string }
const tabs = ['Overview', 'Analysis', 'Clip workflow'] as const
const count = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 ? value.toLocaleString() : 'Not available'

function SignalBars({ samples }: { samples: MomentContext['samples'] }) {
  const values = samples.slice(0, 60).map(sample => sample.messages !== null && Number.isFinite(sample.messages) && sample.messages >= 0 ? sample.messages : null)
  const maximum = Math.max(1, ...values.map(value => value ?? 0))
  return <div className="pl-signal-bars" aria-hidden="true">{values.map((value, index) => <span key={index} className={value === null ? 'pl-signal-gap' : ''}
    style={{ height: value === null ? '100%' : `${Math.max(2, value / maximum * 100)}%` }} />)}</div>
}

/** Glanceable metadata preview, never a substitute image for missing video. */
export function ReactionStrip({ context }: { context: MomentContext }) {
  return <div className="pl-reaction-strip"><SignalBars samples={context.samples} /><span className="pl-muted">{context.provenance === 'fixture' ? 'Demo signal' : 'Signal snapshot'} · {context.coverage === 'partial' ? 'Partial coverage' : context.windowLabel}<br />Inspect measurements in Preview</span></div>
}

export function ReactionPreview({ context }: { context: MomentContext }) {
  const values = context.samples.slice(0, 60)
  return <figure className="pl-reaction-preview">
    <figcaption className="pl-row pl-between"><strong>Chat activity</strong><span className="pl-muted">{context.windowLabel} · messages / minute</span></figcaption>
    <SignalBars samples={values} />
    <div className="pl-row pl-between pl-muted"><span>{values.length ? timestamp(values[0].offsetSeconds) : 'No samples'}</span><span>One-minute buckets · gaps are not zero</span><span>{values.length ? timestamp(values[values.length - 1].offsetSeconds) : ''}</span></div>
    <details><summary>Read chart values</summary><table className="pl-data-table"><caption>Chat activity, messages per one-minute bucket</caption><thead><tr><th scope="col">Position</th><th scope="col">Messages</th></tr></thead><tbody>{values.map((sample, index) => <tr key={index}><th scope="row">{timestamp(sample.offsetSeconds)}</th><td>{count(sample.messages)}</td></tr>)}</tbody></table></details>
  </figure>
}

export function MomentPreview({ moment, context, presentation, busy, error, onClose, onSave, onOpenLink }: {
  moment: LibraryMoment; context?: MomentContextState; busy: boolean; error: string | null
  presentation?: MomentPresentation
  onClose: () => void; onSave: (reference: MomentReference) => void; onOpenLink: () => void
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Overview')
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId(); const url = replayUrl(moment)
  const data = context?.kind === 'ready' ? context.value : undefined
  const analysisUrl = safePresentationUrl(presentation?.analysisUrl)
  return <LibraryDialog title="Moment preview" onClose={onClose} canClose={!busy}>
    <header className="pl-preview-heading"><span className="pl-eyebrow">{moment.channel} / {timestamp(moment.offsetSeconds)}</span><h3>{moment.title}</h3>
      <p className="pl-moment-identity">{presentation?.gameAtMoment ?? 'Game at this moment unknown'}</p>
      <div className="pl-row"><span className="pl-tag">{moment.savedAt !== undefined ? 'Bookmarked' : 'Not bookmarked'}</span>{data ? <span className="pl-muted">{data.provenance === 'fixture' ? 'Illustrative analysis · fixture data' : 'Saved analysis snapshot'} · {data.coverage === 'partial' ? 'Partial coverage' : 'Covered window'}</span> : null}</div></header>
    <div className="pl-preview-tabs" role="tablist" aria-label="Moment detail views">{tabs.map((name, index) => <button key={name} ref={element => { buttons.current[index] = element }}
      className="pl-button" type="button" role="tab" id={`${id}-tab-${index}`} aria-selected={tab === name} aria-controls={`${id}-panel`} tabIndex={tab === name ? 0 : -1}
      onClick={() => setTab(name)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
        if (next !== -1) { event.preventDefault(); setTab(tabs[next]); buttons.current[next]?.focus() }
      }}>{name}</button>)}</div>
    <section id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tabs.indexOf(tab)}`} tabIndex={0} className="pl-stack pl-preview-panel">
      {tab === 'Overview' ? <>
        <MomentMedia moment={moment} presentation={presentation} />
        <MomentSignal presentation={presentation} />
        {data ? <><MomentStats context={data} /><MomentEmotes context={data} compact /></> : <p className="pl-muted" role="status">{context?.kind === 'loading' ? 'Moment stats are loading.' : 'Moment stats are unavailable; missing values are not zero.'}</p>}
        {moment.note ? <blockquote className="pl-preview-note"><span className="pl-eyebrow">YOUR NOTE</span><p>{moment.note}</p></blockquote> : null}
        {analysisUrl ? <a className="pl-analysis-link" href={analysisUrl} target="_blank" rel="noopener noreferrer">View this moment in StreamPulse analysis ↗</a> : null}
      </> : tab === 'Analysis' ? data ? <>
        <MomentStats context={data} />
        <MomentEmotes context={data} />
        <p className="pl-muted">{data.coverage === 'partial' ? 'Partial coverage: missing intervals must not be interpreted as quiet chat.' : 'Coverage describes this window only, not the full broadcast.'} Reaction volume does not establish what happened or whether viewers liked it.</p>
        <p className="pl-muted">{data.provenance === 'fixture' ? 'Demo values, not live measurements.' : 'Snapshot, not a live feed.'} Captured <time dateTime={new Date(data.capturedAt).toISOString()}>{new Date(data.capturedAt).toLocaleString()}</time>. No AI summary has been generated.</p>
        <details><summary>View supporting chart data</summary><ReactionPreview context={data} /></details>
      </> : <p className="pl-muted">{context?.kind === 'loading' ? 'Analysis is loading.' : 'No analysis snapshot is available. Missing measurements are not shown as zero.'}</p> : <>
        <span className="pl-eyebrow">FUTURE REPLAYFORGE HANDOFF</span><h3>A bookmark can become a clip idea.</h3>
        <ol className="pl-workflow"><li><strong>Keep the source and your intent</strong><p>Bookmark a moment and note why it matters. This does not create a clip.</p></li><li><strong>Check the source and permission</strong><p>ReplayForge needs accessible, authorized footage and a valid handoff—not just a timestamp.</p></li><li><strong>Review, trim, then export</strong><p>Editing and rendered-video previews belong in ReplayForge, outside the extension.</p></li></ol>
        <button className="pl-button" type="button" disabled aria-describedby={`${id}-rf-reason`}>Open in ReplayForge · Planned</button><p id={`${id}-rf-reason`} className="pl-muted">Not connected in this preview. No footage is uploaded and no render job is created. Supporter does not include rendering or AI credits.</p>
      </>}
    </section>
    {error ? <p className="pl-error" role="alert">{error}</p> : null}
    <footer className="pl-row pl-preview-actions">{url ? <a className="pl-button pl-primary" href={url} target="_blank" rel="noopener noreferrer" onClick={onOpenLink}><LibraryIcon name="play" />Watch moment <span aria-label="opens in new tab">↗</span></a> : <button type="button" className="pl-button" disabled aria-describedby={`${id}-watch-reason`}>Watch moment</button>}
      <MomentSaveButton moment={moment} busy={busy} onSave={onSave} />
      {!url ? <span id={`${id}-watch-reason`} className="pl-muted">{moment.availability === 'unresolved' ? 'No verified archive link. This does not mean Twitch is still processing it.' : 'The source cannot currently be played.'}</span> : null}
      <span className="pl-muted">Previewing does not add to History.</span></footer>
  </LibraryDialog>
}
