import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Play, ExternalLink } from 'lucide-react'
import { formatStreamOffset } from '../../../lib/formatStreamOffset'
import { verifiedArchiveArtwork, type ArchiveArtwork } from '../../../lib/archiveArtwork'

/** Only receives a freshly verified exact VOD link, never creator/current-stream guesses. */
export function MomentVodPreview({ href, artwork, autoLoad = false }: { href: string; artwork?: ArchiveArtwork; autoLoad?: boolean }) {
  const [failedImage, setFailedImage] = useState<string | null>(null)
  // Playback is opt-in and scoped to one exact verified source. Tracking the
  // *opened* href (rather than the closed one) means the default is unloaded:
  // browsing cards or selecting another result issues zero Twitch requests and
  // cannot inherit a previous moment's opened/error state. At most one player
  // is ever mounted — this component renders only for the selected moment.
  const [openedHref, setOpenedHref] = useState<string | null>(null)
  const [failedHref, setFailedHref] = useState<string | null>(null)
  const opened = openedHref === href
  const failed = failedHref === href
  useEffect(() => {
    if (autoLoad) setOpenedHref(href)
  }, [autoLoad, href])
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
      {!opened ? <button ref={loadButton} type="button" className="moment-vod-preview__load" data-vod-player-mounted="false" onClick={() => { pendingFocus.current = 'close'; setFailedHref(null); setOpenedHref(href) }}>
          <span className="moment-vod-preview__eyebrow">TWITCH VOD · {formatStreamOffset(Number(seconds))}</span>
          <Play className="moment-vod-preview__play" size={28} aria-hidden="true" />
          <strong>Load Twitch preview</strong><span>Review the source at this moment</span>
          <span className="moment-vod-preview__footnote">Nothing is requested from Twitch until you load it · no autoplay</span>
        </button>
        : <><iframe key={href} title="Selected moment Twitch VOD preview" data-vod-player-mounted="true" src={`https://player.twitch.tv/?${query}`} allow="fullscreen" allowFullScreen onError={() => setFailedHref(href)} />
          <button ref={closeButton} type="button" onClick={() => { pendingFocus.current = 'load'; setOpenedHref(null) }}>Close preview</button></>}
    </div> : null}
    <p className={`moment-vod-preview__fallback${!wideEnough ? ' moment-vod-preview__fallback--primary' : ''}`}><a ref={externalLink} href={href} target="_blank" rel="noopener noreferrer">{wideEnough ? 'Open on Twitch' : `Watch on Twitch at ${formatStreamOffset(Number(seconds))}`} <ExternalLink size={16} aria-hidden="true" /></a><span>{failed ? 'Preview could not load. ' : ''}{wideEnough ? 'The preview loads only when you ask for it · no autoplay. ' : ''}Playback depends on Twitch availability.</span></p>
  </div>
}
