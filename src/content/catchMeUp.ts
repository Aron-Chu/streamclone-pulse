import {
  CATCH_ME_UP_READY_EVENT,
  type CatchMeUpActions,
  type CatchMeUpApi,
  type CatchMeUpBlock,
  type CatchMeUpModel,
} from '../shared/catchMeUpContract.ts'
import type { MomentFramesApi } from '../shared/momentFramesContract.ts'
import { formatCount } from '../ui/mostReacted.ts'
import { peakMinute, summaryClock } from './catchMeUpStory.ts'

/**
 * Entry of `content/catch-me-up.js`, injected by the worker into a Twitch tab
 * whose Pulse panel shows a stream recap (src/background/catchMeUpScript.ts),
 * so it never counts against the content script's size budget.
 *
 * It draws the summary at the top of the recap: Twitch's cover of the VOD
 * with the stream's length, the stream's title, the games in order and the
 * peak minute. The recap's moments are its Top moments list, as on live.
 */

const CSS = `
.pcu-sum{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;align-items:center;min-height:63px}
.pcu-sum:has(>.pcu-sum-cover){grid-template-columns:112px minmax(0,1fr)}
.pcu-sum-cover{position:relative;aspect-ratio:16/9;border-radius:6px;overflow:hidden;background:repeating-linear-gradient(135deg,rgba(255,255,255,.06) 0 3px,rgba(255,255,255,.02) 3px 7px)}
.pcu-sum-cover img{display:block;width:100%;height:100%;object-fit:cover}
.pcu-sum-cover span{position:absolute;right:4px;bottom:4px;padding:0 4px;border-radius:3px;background:rgba(0,0,0,.75);color:#fff;font-size:9px;font-weight:800;line-height:14px;font-variant-numeric:tabular-nums}
.pcu-sum-text{display:grid;gap:1px;min-width:0}
.pcu-sum-title{overflow:hidden;color:#fafafc;font-size:12.5px;font-weight:800;text-overflow:ellipsis;white-space:nowrap}
.pcu-sum-games{display:-webkit-box;overflow:hidden;color:#a1a1b2;font-size:11px;font-weight:700;line-height:1.35;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.pcu-sum-peak{margin-top:2px;color:#c9c9d6;font-size:11px;font-variant-numeric:tabular-nums}
.pcu-sum-link{padding:0;border:0;background:none;color:#fda4af;font:inherit;font-weight:800;cursor:pointer}
.pcu-sum-link:hover{text-decoration:underline}
.pcu-sum-link:focus-visible{outline:2px solid rgba(var(--pulse-accent-light-rgb,196,181,253),.95);outline-offset:2px;border-radius:3px}
`

const styledRoots = new WeakSet<Node>()

function addStyles(host: HTMLElement): void {
  const root = host.getRootNode()
  if (styledRoots.has(root)) return
  styledRoots.add(root)
  const style = document.createElement('style')
  style.textContent = CSS
  ;(root instanceof ShadowRoot ? root : document.head).append(style)
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/**
 * The summary (card board, S1): Twitch's cover of the VOD with the stream's
 * length, its title, the games in the order played, and the peak minute, which
 * selects that minute on the chart. The cover and Twitch's title come through
 * the frames script, so with Moment pictures off there are none. The row keeps
 * the cover's height with or without it, so nothing below moves when the
 * cover loads, fails or never comes. Null with nothing to say.
 */
function summary(model: CatchMeUpModel, actions: CatchMeUpActions, frames: MomentFramesApi | undefined): HTMLElement | null {
  const { vodId, games } = model.summary
  const known = model.summary.title?.trim()
  const asks = Boolean(vodId && frames)
  const peak = peakMinute(model.rollups, model.durationSeconds)
  const peakCount = peak?.chatCount ?? model.peakChatPerMin
  if (!asks && !known && games.length === 0 && !(peakCount > 0)) return null
  const box = element('div', 'pcu-sum')
  const text = element('div', 'pcu-sum-text')
  const title = element('div', 'pcu-sum-title')
  const name = (value: string): void => {
    title.textContent = title.title = value
    title.hidden = false
  }
  title.hidden = true
  if (known) name(known)
  text.append(title)
  if (games.length > 0) {
    const route = element('div', 'pcu-sum-games', games.join(' → '))
    route.title = route.textContent!
    text.append(route)
  }
  if (peakCount > 0) {
    const line = element('div', 'pcu-sum-peak', 'Peak ')
    const words = `${formatCount(peakCount)} chat/min`
    if (peak) {
      const link = element('button', 'pcu-sum-link', `${words} at ${summaryClock(peak.offsetSeconds)}`)
      link.type = 'button'
      link.title = 'Select this minute on the chart'
      link.dataset.chartAction = 'true'
      link.addEventListener('click', () => actions.minute(peak.offsetSeconds))
      line.append(link)
    } else {
      line.append(words)
    }
    text.append(line)
  }
  const cover = asks ? element('span', 'pcu-sum-cover') : null
  if (cover && model.durationSeconds > 0) cover.append(element('span', undefined, summaryClock(model.durationSeconds, true)))
  box.append(...(cover ? [cover] : []), text)
  if (asks) {
    void frames!.vod({ vodId }).then(pictures => {
      if (!known && pictures?.title) name(pictures.title)
      const art = pictures?.cover ? element('img') : null
      if (!art) return cover?.remove()
      art.alt = ''
      art.decoding = 'async'
      art.referrerPolicy = 'no-referrer'
      art.addEventListener('error', () => cover?.remove())
      art.src = pictures!.cover!
      cover?.prepend(art)
    }, () => cover?.remove())
  }
  return box
}

function mount(host: HTMLElement, model: CatchMeUpModel, actions: CatchMeUpActions): CatchMeUpBlock | null {
  addStyles(host)
  const facts = summary(model, actions, globalThis.__pulseMomentFrames)
  host.replaceChildren(...(facts ? [facts] : []))
  return facts ? { remove: () => host.replaceChildren() } : null
}

const api: CatchMeUpApi = { mount }

globalThis.__pulseCatchMeUp ??= api
window.dispatchEvent(new Event(CATCH_ME_UP_READY_EVENT))
