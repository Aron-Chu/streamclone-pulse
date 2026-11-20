import { useRef, useState, type FormEvent } from 'react'
import { buildTwitchTimestampLink, type TimestampLinkResult } from '../../lib/twitchTimestampLink'
import { captureTimestampLinkBuilt } from '../../lib/productAnalytics'
import { TimestampToolFeedback } from '../../ui/components/TimestampToolFeedback'
import './growth-guides.css'

/**
 * The Twitch VOD timestamp link builder: a replay link and a player time in, a
 * clean link out. Runs in the browser; it uploads nothing and does not check
 * that the replay exists. It sits at the top of the timestamps guide.
 */
export function TimestampLinkBuilder() {
  const [video, setVideo] = useState('')
  const [timestamp, setTimestamp] = useState('')
  const [result, setResult] = useState<TimestampLinkResult | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const [hasCopied, setHasCopied] = useState(false)
  const copyButton = useRef<HTMLButtonElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const timeInput = useRef<HTMLInputElement>(null)
  const output = useRef<HTMLInputElement>(null)
  const copyGeneration = useRef(0)
  function submit(event: FormEvent) {
    event.preventDefault()
    copyGeneration.current += 1
    const next = buildTwitchTimestampLink(video, timestamp)
    setResult(next); setCopyStatus('')
    if (next.ok) captureTimestampLinkBuilt()
    if (!next.ok) (next.field === 'video' ? videoInput : timeInput).current?.focus()
  }
  function change(set: (value: string) => void, value: string) { copyGeneration.current += 1; set(value); setResult(null); setCopyStatus('') }
  async function copy() {
    if (!result?.ok) return
    const generation = ++copyGeneration.current
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(result.url)
      if (generation === copyGeneration.current) { setCopyStatus('Link copied.'); setHasCopied(true) }
    } catch {
      if (generation !== copyGeneration.current) return
      output.current?.focus(); output.current?.select()
      setCopyStatus('Copy is unavailable here. The link is selected; copy it with your browser or keyboard.')
    }
  }
  return <section id="builder" className="timestamp-builder" aria-label="Timestamp link builder">
    <form className="timestamp-form" onSubmit={submit} noValidate>
      <div><label htmlFor="vod-link">Twitch VOD link or video ID</label>
        <input ref={videoInput} id="vod-link" type="text" autoComplete="off" spellCheck={false} maxLength={2048} value={video}
          onChange={event => change(setVideo, event.target.value)} placeholder="https://www.twitch.tv/videos/…"
          aria-invalid={result?.ok === false && result.field === 'video'} aria-describedby={`vod-link-help${result?.ok === false && result.field === 'video' ? ' timestamp-error' : ''}`} />
        <p id="vod-link-help">Use the replay’s /videos/ link, not a channel or clip URL.</p></div>
      <div><label htmlFor="vod-time">Start time</label>
        <input ref={timeInput} id="vod-time" type="text" inputMode="text" autoComplete="off" spellCheck={false} maxLength={64} value={timestamp}
          onChange={event => change(setTimestamp, event.target.value)} placeholder="1:23:45"
          aria-invalid={result?.ok === false && result.field === 'time'} aria-describedby={`vod-time-help${result?.ok === false && result.field === 'time' ? ' timestamp-error' : ''}`} />
        <p id="vod-time-help">Use h:mm:ss, m:ss, whole seconds, or 1h23m45s. Leave blank to use the link’s existing timestamp. Enter 0 to start at the beginning.</p></div>
      {result?.ok === false ? <p id="timestamp-error" role="alert" className="timestamp-form__error">{result.message}</p> : null}
      <button type="submit" className="btn btn-primary">Build timestamp link</button>
    </form>
    {result?.ok ? <section className="timestamp-result" aria-label="Your timestamp link" aria-live="polite">
      <h2>Your link starts at {result.displayTime}</h2>
      <label htmlFor="timestamp-result">Timestamped Twitch link</label>
      <input ref={output} id="timestamp-result" readOnly value={result.url} onFocus={event => event.currentTarget.select()} />
      <div className="public-document__actions"><button ref={copyButton} type="button" className="btn btn-secondary" onClick={copy}>Copy link</button>
        <a className="btn btn-secondary" href={result.url} target="_blank" rel="noopener noreferrer">Open on Twitch</a></div>
      <p role="status">{copyStatus}</p>
      <p>A correctly formatted link can still point to a deleted, unpublished, subscriber-only, or shorter video. Open it on Twitch to verify it before sharing.</p>
    </section> : null}
    {hasCopied ? <TimestampToolFeedback returnFocus={() => (copyButton.current ?? videoInput.current)?.focus()} /> : null}
  </section>
}
