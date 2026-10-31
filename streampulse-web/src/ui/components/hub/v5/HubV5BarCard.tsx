/**
 * The d3-v5 hub's bar card (R5-8 option A, Aron 2026-10-15): a click on an
 * activity bar opens the session page's card as a strip under the chart, at
 * every width. It never covers the chart or the Moments rail; there is no
 * dock, pop-out or phone sheet. A port of the mockup's bucket-card.js 'below'
 * placement with round3-ui.js `modelA` (R5-18's top channels and R5-23's
 * tidied card wait for Aron).
 *
 * One store holds the selection (hubBucketSelection): the chart draws the
 * sliding band and this card reads the same snapshot. ‹ › step bars at the
 * chart's level, Zoom to bar zooms the chart, Esc or × closes, and focus goes
 * back to the plot when it was in the card. The card makes no request.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { sanitizeEmoteImageUrl } from '../../../../lib/emoteAssetUrl'
import type { HubActivityPoint, HubLivePulseMoment } from '../../../../lib/publicHub'
import { clearHubBucketSelection, getHubChartBridge, hubBucketSelectionStore, selectHubBucket } from '../../../../lib/hubBucketSelection'
import { HubV5Avatar } from './HubV5Avatar'
import { HubV5Icon } from './HubV5Icon'
import { buildHubV5BarCard, HUB_V5_BAR_STATE, type HubV5BarCardModel, type HubV5BarEmote, type HubV5BarFig, type HubV5BarMoment } from './hubV5BarCardModel'
import './hub-v5-bar-card.css'

/** The mockup's leave transition (bucket-card.js close). */
const LEAVE_MS = 140

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The d3 chart's 45° hatch for spans it did not measure (no gradient). */
function Hatch() {
  return (
    <svg className="hbk-hatch" viewBox="0 0 16 12" aria-hidden="true" focusable="false">
      <path d="M-3 9 6-0M1 13 14 0M7 15 19 3M13 15l6-6" stroke="#8e8e96" strokeOpacity=".7" strokeWidth="1.25" fill="none" />
    </svg>
  )
}

/** A fresh card that lands wholly below the window scrolls up just enough to show it, never past the top of the plot. */
function reveal(card: HTMLElement) {
  const r = card.getBoundingClientRect()
  if (r.top < window.innerHeight - 48) return
  const plot = getHubChartBridge()?.plotElement()?.getBoundingClientRect()
  const dy = Math.min(r.bottom - window.innerHeight + 16, plot ? plot.top - 64 : Number.POSITIVE_INFINITY)
  if (dy > 0) window.scrollBy({ top: dy, behavior: reducedMotion() ? 'auto' : 'smooth' })
}

function Fig({ fig }: { fig: HubV5BarFig }) {
  return (
    <div className="hbk-fig" title={fig.title ?? undefined}>
      <span className={fig.value == null ? 'hbk-n na' : 'hbk-n'}>{fig.valueText}</span>
      <span className="hbk-fl"><i className={`hbk-sw ${fig.key}`} aria-hidden="true" />{fig.label}</span>
      <span className="hbk-u"><span className="hbk-ut">{fig.third ?? ' '}</span></span>
    </div>
  )
}

/** An emote picture that fails to load, or whose URL is not an allowlisted https one, becomes the quiet two-letter placeholder. */
function EmoteImage({ emote }: { emote: HubV5BarEmote }) {
  const [failed, setFailed] = useState(false)
  const src = sanitizeEmoteImageUrl(emote.imageUrl ?? undefined)
  if (!src || failed) return <span className="hbk-noimg" aria-hidden="true">{emote.name.slice(0, 2) || '?'}</span>
  return <img src={src} alt="" width={28} height={28} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

function Emotes({ model }: { model: HubV5BarCardModel }) {
  if (!model.topEmotes.length) {
    return (
      <div className="hbk-emo">
        <p className="hbk-sl"><span>Top emotes</span><span className="r">{model.topEmotesNote}</span></p>
      </div>
    )
  }
  return (
    <div className="hbk-emo">
      <p className="hbk-sl"><span>Top emotes</span><span className="r">per min{model.topEmotesExact ? '' : ' · ≥ = at least'}</span></p>
      <ul className="hbk-el">
        {model.topEmotes.map((emote) => (
          <li key={emote.key} title={emote.title}>
            <EmoteImage emote={emote} />
            <span className="hbk-en">{emote.name}</span>
            <span className="hbk-ec">{emote.rateText}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MomentRow({ item }: { item: HubV5BarMoment }) {
  const te = item.topEmote
  const teSrc = sanitizeEmoteImageUrl(te?.imageUrl ?? undefined)
  return (
    <li>
      <Link className="hbk-mr" to={item.href} aria-label={item.aria} data-mom-key={item.key}>
        <HubV5Avatar login={item.login} name={item.channel} src={item.avatar} size={20} />
        <span className="nm" title={item.channel}>{item.channel}</span>
        <span className="ck">{item.clockLabel}</span>
        {te ? (
          <span className="em" title={`${te.name} ×${te.count.toLocaleString('en-US')} in that minute`}>
            {teSrc ? <img src={teSrc} alt="" width={20} height={20} decoding="async" referrerPolicy="no-referrer" /> : null}
            <span className="hv5-vh">{te.name} </span>×{te.count.toLocaleString('en-US')}
          </span>
        ) : null}
      </Link>
    </li>
  )
}

function Moments({ model }: { model: HubV5BarCardModel }) {
  const { items, total, note } = model.moments
  if (!items.length) {
    return (
      <div className="hbk-mom">
        <p className="hbk-sl"><span>Moments</span><span className="r">{note ?? 'none'}</span></p>
      </div>
    )
  }
  return (
    <div className="hbk-mom">
      <p className="hbk-sl"><span>Moments</span><span className="r">{total}</span></p>
      <ul className="hbk-ml">
        {items.slice(0, 3).map((item) => <MomentRow key={item.key} item={item} />)}
      </ul>
    </div>
  )
}

function Providers({ model }: { model: HubV5BarCardModel }) {
  const p = model.providers
  if (!p) return null
  const int = (v: number) => Math.round(v).toLocaleString('en-US')
  return (
    <div className="hbk-pv" title="The minutes data splits out 7TV only. Twitch, BTTV and FFZ are in other.">
      <p className="hbk-sl">
        <span>By provider, per min</span>
        <span className="r"><span>7TV <b>{int(p.sevenTv)}</b></span><span aria-hidden="true">·</span><span>other <b>{int(p.other)}</b></span></span>
      </p>
    </div>
  )
}

function step(dir: -1 | 1) {
  const selection = hubBucketSelectionStore.getSnapshot().selection
  const next = selection ? getHubChartBridge()?.stepBar?.(selection.t, dir) : null
  if (next) selectHubBucket({ ...next, source: selection!.source })
}

function zoom(model: HubV5BarCardModel) {
  getHubChartBridge()?.zoomToMs?.(model.t, model.end)
}

function CardBody({ model, titleId }: { model: HubV5BarCardModel; titleId: string }) {
  const head = (
    <header className="hbk-h">
      <div className="hbk-top">
        <p className="hbk-s">{model.stateLabel}</p>
        <button type="button" className="hv5-ib hbk-x" data-act="close" aria-label="Close (Esc)" title="Close (Esc)" onClick={clearHubBucketSelection}>
          <HubV5Icon name="x" />
        </button>
      </div>
      <div className="hbk-id">
        <div className="hbk-hl">
          <h2 className="hbk-t" id={titleId}><span className="hv5-vh">{HUB_V5_BAR_STATE}: </span>{model.title}</h2>
          <p className="hbk-m"><span className="hbk-d hbk-dc">{model.when}</span></p>
        </div>
      </div>
    </header>
  )
  if (model.gap) {
    return (
      <>
        {head}
        <div className="hbk-body">
          <div className="hbk-gap">
            <span className="hbk-gapm" aria-hidden="true"><Hatch /></span>
            <div>
              <p className="hbk-gt">Not measured</p>
              {model.reason ? <p className="hbk-cap">{model.reason}</p> : null}
            </div>
          </div>
        </div>
      </>
    )
  }
  return (
    <>
      {head}
      <div className="hbk-body">
        <div className="hbk-fg">
          <div className="hbk-figs">{model.figs.map((fig) => <Fig key={fig.key} fig={fig} />)}</div>
        </div>
        <Emotes model={model} />
        <Moments model={model} />
        <Providers model={model} />
        <div className="hbk-nw">
          {model.notes.length ? <ul className="hbk-notes">{model.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
        </div>
      </div>
      <div className="hbk-act">
        <button type="button" className="hv5-qb hbk-zoom" data-act="zoom" onClick={() => zoom(model)}>
          <HubV5Icon name="zoom" />Zoom to bar
        </button>
        <span className="hv5-step">
          <button type="button" className="hv5-ib" data-act="prev" aria-label="Previous bar" onClick={() => step(-1)}><HubV5Icon name="left" /></button>
          <span>{model.minutes}-min bar</span>
          <button type="button" className="hv5-ib" data-act="next" aria-label="Next bar" onClick={() => step(1)}><HubV5Icon name="right" /></button>
        </span>
      </div>
    </>
  )
}

export interface HubV5BarCardProps {
  /** The points the chart draws (`selectHubChartActivityInputs(hub).points`). */
  points: readonly HubActivityPoint[]
  bucketMinutes: number
  /** The hub's detected moments (`livePulseMoments`). */
  moments: readonly HubLivePulseMoment[]
  avatars?: ReadonlyMap<string, string>
}

export function HubV5BarCard({ points, bucketMinutes, moments, avatars }: HubV5BarCardProps) {
  const selection = useSyncExternalStore(
    hubBucketSelectionStore.subscribe,
    hubBucketSelectionStore.getSnapshot,
    hubBucketSelectionStore.getServerSnapshot,
  ).selection
  const model = useMemo(
    () => (selection ? buildHubV5BarCard({ points, bucketMinutes, t: selection.t, endT: selection.endT, moments, avatars }) : null),
    [selection, points, bucketMinutes, moments, avatars],
  )

  // A selection the points no longer hold (a new window) closes its card and its band.
  useEffect(() => {
    if (selection && !model) clearHubBucketSelection()
  }, [selection, model])

  // The enter/leave state lives in a child: React 18 loses a store snapshot when a
  // component that reads the store also sets state while it renders.
  return <BarCardView model={model} />
}

function BarCardView({ model }: { model: HubV5BarCardModel | null }) {
  // The closing card stays for its 140 ms fade (0 under reduced motion), so focus can go back to the plot.
  const [prevModel, setPrevModel] = useState(model)
  const [leaving, setLeaving] = useState<HubV5BarCardModel | null>(null)
  const [entering, setEntering] = useState(false)
  if (model !== prevModel) {
    setPrevModel(model)
    if (model) {
      setLeaving(null)
      if (!prevModel && !reducedMotion()) setEntering(true)
    } else if (prevModel) {
      setLeaving(prevModel)
      setEntering(false)
    }
  }
  const shown = model ?? leaving

  const cardRef = useRef<HTMLElement>(null)
  const openRef = useRef(false)
  useLayoutEffect(() => {
    const wasOpen = openRef.current
    openRef.current = model != null
    const card = cardRef.current
    if (model && !wasOpen && card) reveal(card)
    if (!model && wasOpen && card?.contains(document.activeElement)) getHubChartBridge()?.focusPlot?.()
  }, [model])

  useEffect(() => {
    if (!entering) return undefined
    const id = window.requestAnimationFrame(() => setEntering(false))
    return () => window.cancelAnimationFrame(id)
  }, [entering])
  useEffect(() => {
    if (!leaving) return undefined
    const id = window.setTimeout(() => setLeaving(null), reducedMotion() ? 0 : LEAVE_MS)
    return () => window.clearTimeout(id)
  }, [leaving])

  // Esc closes the card from anywhere but a text field; an open moment hover card closes first.
  const isOpen = model != null
  useEffect(() => {
    if (!isOpen) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as Element | null
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('[data-hv5-moment-card]')) return
      event.preventDefault()
      clearHubBucketSelection()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])

  // The live region says what the card shows, after the swap (the mockup's announce).
  const [said, setSaid] = useState('')
  useEffect(() => {
    setSaid('')
    if (!model) return undefined
    const id = window.setTimeout(() => setSaid(model.summary), 30)
    return () => window.clearTimeout(id)
  }, [model])

  const state = model ? (entering ? 'enter' : 'open') : 'leave'
  const titleId = 'hv5-hbk-t'
  return (
    <div id="bk" className="hv5-bk" data-hub-bar-card-host="">
      <div className="hv5-vh" aria-live="polite" aria-atomic="true" data-hub-bar-card-live="">{said}</div>
      {shown ? (
        <section
          ref={cardRef}
          className={`hbk hbk--below${state === 'enter' ? ' hbk-enter' : state === 'leave' ? ' hbk-leave' : ''}`}
          role="region"
          aria-labelledby={titleId}
          data-scope="hub"
          data-hub-bar-card={state}
          data-gap={shown.gap ? '' : undefined}
        >
          <div className="hbk-in">
            <CardBody model={shown} titleId={titleId} />
          </div>
        </section>
      ) : null}
    </div>
  )
}
