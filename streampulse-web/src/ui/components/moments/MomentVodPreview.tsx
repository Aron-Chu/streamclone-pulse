import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Play, ExternalLink } from 'lucide-react'
import { formatStreamOffset } from '../../../lib/formatStreamOffset'
import { verifiedArchiveArtwork, type ArchiveArtwork } from '../../../lib/archiveArtwork'

/** Only receives a freshly verified exact VOD link, never creator/current-stream guesses. */
export function MomentVodPreview({ href, artwork }: { href: string; artwork?: ArchiveArtwork }) {
  const [failedImage, setFailedImage] = useState<string | null>(null)
  // Load only the selected, verified source. Closing is scoped to that source;
  // changing moments must not inherit a previous moment's closed/error state.
  const [closedHref, setClosedHref] = useState<string | null>(null)
  const [failedHref, setFailedHref] = useState<string | null>(null)
  const opened = closedHref !== href
  const failed = failedHref === href
  const [wideEnough, setWideEnough] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const loadButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const externalLink = useRef<HTMLAnchorElement>(null)
  const pendingFocus = useRef<'load' | 'close' | 'external' | null>(null)
  const desktopHadFocus = useRef(false)
  useLayoutEffect(() => {
    const target = pendingFocus.current
    pendingFocus.current = null
    if (target === 'external' || (target && !wideEnough)) externalLink.current?.focus()
    else if (target === 'close') closeButton.current?.focus()
    else if (target === 'load') loadButton.current?.focus()
  }, [opened, wideEnough])
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(entries => {
      const wide = entries[0].contentRect.width >= 400
      // Container-query CSS can hide the focused control before this observer runs.
      if (!wide && (element.querySelector('.moment-vod-preview__desktop')?.contains(document.activeElement)
        || (desktopHadFocus.current && document.activeElement === document.body))) pendingFocus.current = 'external'
      if (!wide) desktopHadFocus.current = false
      setWideEnough(wide)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [href])
  let url: URL
  try { url = new URL(href) } catch { return null }
  const id = /^\/videos\/(\d+)$/.exec(url.pathname)?.[1]
  const seconds = /^(\d+)s$/.exec(url.searchParams.get('t') ?? '')?.[1]
  if (url.origin !== 'https://www.twitch.tv' || !id || !seconds) return null
  const image = verifiedArchiveArtwork(artwork, id)
  const query = new URLSearchParams({ video: `v${id}`, time: `${seconds}s`, parent: window.location.hostname, autoplay: 'false' })
  return <div className="moment-vod-preview" ref={container}>
    {(!wideEnough || !opened) && image && failedImage !== image.url ? <figure className="moment-vod-artwork">
      <img src={image.url} alt="Thumbnail from this broadcast, not the selected moment frame" onError={() => setFailedImage(image.url)} />
      <figcaption>Broadcast thumbnail · not an exact moment frame</figcaption>
    </figure> : null}
    {wideEnough ? <div className="moment-vod-preview__desktop" onFocusCapture={() => { desktopHadFocus.current = true }}
      onBlurCapture={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) desktopHadFocus.current = false }}>
      {!opened ? <button ref={loadButton} type="button" className="moment-vod-preview__load" onClick={() => { pendingFocus.current = 'close'; setFailedHref(null); setClosedHref(null) }}>
          <span className="moment-vod-preview__eyebrow">TWITCH VOD · {formatStreamOffset(Number(seconds))}</span>
          <Play className="moment-vod-preview__play" size={28} aria-hidden="true" />
          <strong>Load Twitch preview</strong><span>Review the source at this moment</span>
          <span className="moment-vod-preview__footnote">Preview closed · reopen without autoplay</span>
        </button>
        : <><iframe key={href} title="Selected moment Twitch VOD preview" src={`https://player.twitch.tv/?${query}`} allow="fullscreen" allowFullScreen onError={() => setFailedHref(href)} />
          <button ref={closeButton} type="button" onClick={() => { pendingFocus.current = 'load'; setClosedHref(href) }}>Close preview</button></>}
    </div> : <p>Open on Twitch to watch at this screen size.</p>}
    <div className="moment-vod-preview__fallback"><a ref={externalLink} className="moments-watch-action" href={href} target="_blank" rel="noopener noreferrer">Watch at {formatStreamOffset(Number(seconds))} on Twitch <ExternalLink size={13} aria-hidden="true" /></a>{failed ? <span role="status">Preview could not load. Playback depends on Twitch availability.</span> : null}</div>
  </div>
}
