import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { ChromeInstallCta } from '../../ui/components/ChromeInstallCta'
import { buildTwitchTimestampLink, type TimestampLinkResult } from '../../lib/twitchTimestampLink'
import './growth-guides.css'

export default function TwitchTimestampTool() {
  const [video, setVideo] = useState('')
  const [timestamp, setTimestamp] = useState('')
  const [result, setResult] = useState<TimestampLinkResult | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const videoInput = useRef<HTMLInputElement>(null)
  const timeInput = useRef<HTMLInputElement>(null)
  const output = useRef<HTMLInputElement>(null)
  const copyGeneration = useRef(0)
  function submit(event: FormEvent) {
    event.preventDefault()
    copyGeneration.current += 1
    const next = buildTwitchTimestampLink(video, timestamp)
    setResult(next); setCopyStatus('')
    if (!next.ok) (next.field === 'video' ? videoInput : timeInput).current?.focus()
  }
  function change(set: (value: string) => void, value: string) { copyGeneration.current += 1; set(value); setResult(null); setCopyStatus('') }
  async function copy() {
    if (!result?.ok) return
    const generation = ++copyGeneration.current
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(result.url)
      if (generation === copyGeneration.current) setCopyStatus('Link copied.')
    } catch {
      if (generation !== copyGeneration.current) return
      output.current?.focus(); output.current?.select()
      setCopyStatus('Copy is unavailable here. The link is selected; copy it with your browser or keyboard.')
    }
  }
  return <PublicLayout><article className="panel public-document growth-guide">
    <p className="growth-guide__eyebrow">Free Twitch tool</p>
    <h1>Twitch VOD timestamp link builder</h1>
    <p>Share the exact time you already found in a Twitch replay. Paste a past-broadcast link, enter the player time, and copy a clean link.</p>
    <p>This works in your browser. It does not upload your inputs, search a video, or check whether a replay is available.</p>
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
      <div className="public-document__actions"><button type="button" className="btn btn-secondary" onClick={copy}>Copy link</button>
        <a className="btn btn-secondary" href={result.url} target="_blank" rel="noopener noreferrer">Open on Twitch</a></div>
      <p role="status">{copyStatus}</p>
      <p>A correctly formatted link can still point to a deleted, unpublished, subscriber-only, or shorter video. Open it on Twitch to verify it before sharing.</p>
    </section> : null}
    <h2>Which timestamp should I enter?</h2>
    <p>Use the elapsed time shown in the Twitch VOD player. For example, 1:23:45 is 5,025 seconds after the replay starts. A wall-clock time such as “8:15 pm” does not identify a replay position.</p>
    <p>If you found a moment in StreamPulse, use its verified replay action when available. Broadcast time and VOD time can have an offset; this builder does not calculate that alignment.</p>
    <h2>Need to find a moment first?</h2>
    <p>StreamPulse shows chat and emote reactions for streams it tracked. It can help you choose moments to review; it does not analyze every past Twitch VOD on demand.</p>
    <div className="public-document__actions"><ChromeInstallCta className="btn btn-primary" /><Link className="btn btn-secondary" to="/analytics">Explore tracked channels</Link></div>
    <nav className="growth-guide__related" aria-label="Related tools and guides"><Link to="/guides/find-twitch-moments">Find and bookmark tracked reaction moments</Link><Link to="/guides/twitch-vod-timestamps">Understand replay availability and timestamps</Link><Link to="/docs#extension">Installation guide</Link></nav>
    <p className="growth-guide__source">Twitch also offers a “Skip to” option in its sharing controls. <a href="https://help.twitch.tv/s/article/how-to-share-a-stream" target="_blank" rel="noopener noreferrer">Read Twitch’s sharing guide</a>.</p>
  </article></PublicLayout>
}
