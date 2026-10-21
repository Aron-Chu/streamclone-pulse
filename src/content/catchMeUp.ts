import { displayMomentReasonLabel, isEmoteSpikeReason, isViewerSpikeReason, momentClockDisplay, type LiveHeatEmote, type LiveHeatPoint } from '@streampulse/pulse-core'
import {
  CATCH_ME_UP_READY_EVENT,
  type CatchMeUpActions,
  type CatchMeUpApi,
  type CatchMeUpBlock,
  type CatchMeUpModel,
  type CatchMeUpMoment,
  type CatchMeUpParts,
} from '../shared/catchMeUpContract.ts'
import { extensionEmoteImageUrls } from '../shared/emoteUrl.ts'
import type { MomentFramesApi, MomentPictureView } from '../shared/momentFramesContract.ts'
import { formatMomentMetricsLine } from '../ui/momentActivity.ts'
import { formatCount } from '../ui/mostReacted.ts'
import { peakMinute, summaryClock } from './catchMeUpStory.ts'

/**
 * Entry of `content/catch-me-up.js`, injected by the worker into a Twitch tab
 * whose Pulse panel shows a stream recap (src/background/catchMeUpScript.ts),
 * so it never counts against the content script's size budget.
 *
 * It draws the top of the recap: a summary of the stream (Twitch's cover and
 * title, the games in order and the peak minute), the #1 moment with its
 * picture, and the next two. On a VOD page, where the chart comes first, it
 * draws the summary above the chart and the best three under it as tiles,
 * then Watch best (CatchMeUpParts). Pictures come from the frames script: the
 * frames this tab captured while it played the stream, else Twitch's or the
 * backend's picture of the moment; with none, the block shows no picture.
 */

const CSS = `
.pcu{display:grid;gap:10px}
.pcu-sum{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;align-items:center}
.pcu-sum[data-asks]{min-height:63px}
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
.pcu-hero{display:grid;border:1px solid rgba(var(--pulse-accent-light-rgb,167,139,250),.22);border-radius:12px;background:rgba(255,255,255,.03);overflow:hidden}
.pcu-pic{padding:8px 8px 0}
.pcu-pic:empty{display:none}
.pcu-body{display:grid;gap:6px;min-width:0;padding:10px 12px 12px}
.pcu-rank{color:#f97316;font-size:11px;font-weight:800}
.pcu-metrics{color:#a1a1b2;font-size:11px;font-weight:600;line-height:18px;font-variant-numeric:tabular-nums}
.pcu-top-emote{display:inline-flex;align-items:center;gap:4px;max-width:100%;vertical-align:top}
.pcu-top-emote img{flex:none;width:16px;height:16px;object-fit:contain}
.pcu-game{display:flex;align-items:center;gap:6px;min-width:0;color:#a1a1b2;font-size:11px;font-weight:700}
.pcu-game img{flex:none;width:15px;height:20px;border-radius:2px;object-fit:cover}
.pcu-game span,.pcu-top-emote span,.pcu-mini-text span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pcu-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}
.pcu .pcu-btn{display:inline-flex;align-items:center;gap:5px;min-height:28px;padding:5px 10px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(255,255,255,.04);color:#fafafc;font:inherit;font-size:10.5px;font-weight:800;cursor:pointer}
.pcu .pcu-btn[data-primary]{background:rgba(var(--pulse-accent-rgb,139,92,246),.2);border-color:rgba(var(--pulse-accent-light-rgb,167,139,250),.46);color:var(--pulse-accent-ink,#ddd6fe)}
.pcu-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.pcu-mini{display:grid;align-content:start;gap:6px;min-width:0;padding:6px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.03);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .15s ease,background .15s ease}
.pcu-mini:hover{border-color:rgba(255,255,255,.2)}
.pcu-mini[aria-pressed="true"]{border-color:rgba(var(--pulse-accent-light-rgb,167,139,250),.6);background:rgba(var(--pulse-accent-rgb,139,92,246),.1)}
.pcu-mini:focus-visible{outline:2px solid rgba(var(--pulse-accent-light-rgb,196,181,253),.95);outline-offset:2px}
.pcu-mini .pmf-thumb{display:none;width:100%;height:auto;aspect-ratio:16/9;border-radius:6px}
.pcu-mini-text{display:grid;gap:2px;min-width:0;padding:0 2px 2px;color:#8b8ba0;font-size:10.5px;font-weight:600}
.pcu-mini-text b{color:#fafafc;font-size:11.5px;font-weight:800;font-variant-numeric:tabular-nums}
.pcu-slot .pulse-moment-slot{margin-top:10px}
.pcu-part:empty{display:none}
.pcu-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.pcu-tile{display:grid;align-content:start;gap:4px;min-width:0;padding:0;border:0;background:none;color:#8b8ba0;font:inherit;font-size:10.5px;font-weight:600;line-height:1.3;text-align:left;cursor:pointer}
.pcu-tile:focus-visible{outline:2px solid rgba(var(--pulse-accent-light-rgb,196,181,253),.95);outline-offset:2px;border-radius:8px}
.pcu-tile-pic{position:relative;display:grid;place-content:center;justify-items:center;aspect-ratio:16/9;border:1px solid rgba(255,255,255,.08);border-radius:8px;background:rgba(255,255,255,.03);overflow:hidden;color:#fafafc;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;transition:border-color .15s ease}
.pcu-tile:hover .pcu-tile-pic{border-color:rgba(255,255,255,.2)}
.pcu-tile[aria-pressed="true"] .pcu-tile-pic{border-color:transparent;box-shadow:0 0 0 2px rgba(var(--pulse-accent-light-rgb,167,139,250),.9)}
.pcu-tile-face{position:relative;z-index:1;display:grid;justify-items:center;gap:2px}
.pcu-tile-face img{width:30px;height:30px;object-fit:contain}
.pcu-tile .pmf-thumb{display:none}
.pcu-tile .pmf-thumb[data-has]{display:block;position:absolute;inset:0;width:100%;height:100%;border-radius:0}
.pcu-tile-pic:has([data-has]){place-content:end start;padding:0 6px 4px}
.pcu-tile-pic:has([data-has])::after{content:'';position:absolute;inset:45% 0 0;background:linear-gradient(transparent,rgba(0,0,0,.8))}
.pcu-tile-pic:has([data-has]) .pcu-tile-face{display:flex;align-items:center;gap:4px;text-shadow:0 1px 4px #000}
.pcu-tile-pic:has([data-has]) img{width:16px;height:16px}
.pcu-tile-cap{overflow-wrap:anywhere}
.pcu-tile-cap b{color:#fafafc;font-weight:800;font-variant-numeric:tabular-nums}
.pcu .pcu-wide{width:100%;justify-content:center;min-height:32px}
.pcu-more>summary{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.03);color:#a1a1b2;font-size:11.5px;font-weight:700;list-style:none;cursor:pointer}
.pcu-more>summary::-webkit-details-marker{display:none}
.pcu-more>summary::after{content:'▾'}
.pcu-more[open]>summary{border-color:rgba(255,255,255,.18)}
.pcu-more[open]>summary::after{transform:rotate(180deg)}
.pcu-more-in{display:grid;gap:10px;padding-top:10px}
.pcu-more .pulse-moment-slot{margin-top:4px}
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

/** An image that walks its candidates and leaves when none load. */
function image(urls: string[], alt: string): HTMLImageElement | null {
  if (urls.length === 0) return null
  const node = element('img')
  let tried = 0
  node.alt = alt
  node.decoding = 'async'
  node.referrerPolicy = 'no-referrer'
  node.addEventListener('error', () => (++tried < urls.length ? (node.src = urls[tried]!) : node.remove()))
  node.src = urls[0]!
  return node
}

function button(text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const node = element('button', 'pcu-btn pulse-action-chip', text)
  node.type = 'button'
  node.toggleAttribute('data-primary', primary)
  if (primary) node.classList.add('pulse-action-chip-primary')
  // The block sits outside the recap chart; this keeps the chart's
  // outside-click handling from clearing a pick as the click lands.
  node.dataset.chartAction = 'true'
  node.addEventListener('click', onClick)
  return node
}

/**
 * Plays the best moments in turn on a VOD page, where every jump seeks this
 * player; each step waits for the viewer's click.
 */
function watchButton(best: CatchMeUpMoment[], actions: CatchMeUpActions, mark = ''): HTMLButtonElement {
  let next = 0
  const play = button('', () => {
    actions.jump(next)
    next = (next + 1) % best.length
    paint()
  })
  const paint = (): void => {
    play.textContent = mark + (next === 0
      ? `Watch best ${best.length}`
      : `Next: #${next + 1} · ${momentClockDisplay(best[next]!.point).text}`)
  }
  paint()
  return play
}

function label(moment: CatchMeUpMoment): string {
  return displayMomentReasonLabel(moment.point.reason, moment.point.reasonLabel)
}

function burst(emote: LiveHeatEmote): string {
  return `${emote.name} ×${formatCount(emote.count)}`
}

/** The one number a moment's label is about: emotes for an emote spike, viewers for a viewer spike, else chat; none rather than zero. */
function headlineNumber(point: LiveHeatPoint): string | null {
  const chat: [number, string] = [point.chatCount ?? 0, ' chat/min']
  const emotes: [number, string] = [point.emoteCount ?? 0, ' emotes/min']
  const viewers: [number, string] = [point.viewerCount ?? 0, ' viewers']
  const order = isEmoteSpikeReason(point.reason) ? [emotes, chat, viewers] : isViewerSpikeReason(point.reason) ? [viewers, chat, emotes] : [chat, emotes, viewers]
  const found = order.find(([value]) => value > 0)
  return found ? `${formatCount(found[0])}${found[1]}` : null
}

/**
 * The summary (card board, S1): Twitch's cover of the VOD with the stream's
 * length, its title, the games in the order played, and the peak minute, which
 * selects that minute on the chart. The cover and title come from Twitch
 * through the frames script, so with Moment pictures off there are none; the
 * cover's place is kept while they load, and its height after if Twitch has
 * none, so nothing below moves. Null with nothing to say.
 */
function summary(model: CatchMeUpModel, actions: CatchMeUpActions, frames: MomentFramesApi | undefined): HTMLElement | null {
  const { vodId, games, withTitle } = model.summary
  const asks = Boolean(vodId && frames)
  const peak = peakMinute(model.rollups, model.durationSeconds)
  const peakCount = peak?.chatCount ?? model.peakChatPerMin
  if (!asks && games.length === 0 && !(peakCount > 0)) return null
  const box = element('div', 'pcu-sum')
  box.toggleAttribute('data-asks', asks)
  const text = element('div', 'pcu-sum-text')
  const title = element('div', 'pcu-sum-title')
  title.hidden = true
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
      if (withTitle && pictures?.title) {
        title.textContent = title.title = pictures.title
        title.hidden = false
      }
      const art = pictures?.cover ? image([pictures.cover], '') : null
      if (!art) return cover?.remove()
      art.addEventListener('error', () => cover?.remove())
      cover?.prepend(art)
    }, () => cover?.remove())
  }
  return box
}

function mount(host: HTMLElement, model: CatchMeUpModel, actions: CatchMeUpActions, parts?: CatchMeUpParts): CatchMeUpBlock {
  addStyles(host)
  const best = model.moments.slice(0, 3)
  const top = best[0]
  const frames = globalThis.__pulseMomentFrames
  const facts = summary(model, actions, frames)
  const head = parts?.head
  const tail = parts?.tail
  const pictures: Array<() => void> = []
  const picture = (target: HTMLElement, view: MomentPictureView): void => {
    if (frames) pictures.push(frames.mount(target, view, model.at))
  }
  const remove = (): void => {
    pictures.splice(0).forEach(unmount => unmount())
    host.replaceChildren()
    head?.replaceChildren()
    tail?.replaceChildren()
  }
  if (!top) {
    remove()
    return { select: () => {}, remove }
  }
  /** A moment that opens its card under the block when picked. */
  const pickable = (moment: CatchMeUpMoment, index: number, className: string): HTMLButtonElement => {
    const node = element('button', className)
    node.type = 'button'
    node.dataset.chartAction = 'true'
    node.setAttribute('aria-pressed', 'false')
    node.setAttribute('aria-label', `#${index + 1} moment at ${momentClockDisplay(moment.point).text}, ${label(moment)}, ${formatMomentMetricsLine(moment.point)}`)
    node.addEventListener('click', () => actions.pick(index))
    return node
  }

  if (head && tail) {
    if (facts) head.replaceChildren(facts)
    // Each tile is the moment's picture when this tab has one; otherwise its
    // top emote, large, and its time.
    const tiles = best.map((moment, index) => {
      const tile = pickable(moment, index, 'pcu-tile')
      const thumb = element('span', 'pmf-thumb')
      thumb.setAttribute('aria-hidden', 'true')
      picture(thumb, moment.thumb)
      const emote = moment.point.topEmotes.find(item => item.count > 0)
      const face = element('span', 'pcu-tile-face')
      const art = emote && image(extensionEmoteImageUrls(emote, model.backendUrl), '')
      if (art) face.append(art)
      face.append(element('b', undefined, momentClockDisplay(moment.point).text))
      const pic = element('span', 'pcu-tile-pic')
      pic.append(thumb, face)
      const caption = element('span', 'pcu-tile-cap')
      caption.append(element('b', undefined, `#${index + 1}`), ` ${emote ? burst(emote) : label(moment)}`)
      tile.append(pic, caption)
      return tile
    })
    const row = element('div', 'pcu-tiles')
    row.append(...tiles)
    host.replaceChildren(row)
    if (best.length > 1) {
      const bar = element('div', 'pcu')
      const play = watchButton(best, actions, '▶ ')
      play.classList.add('pcu-wide')
      bar.append(play)
      tail.replaceChildren(bar)
    }
    return {
      select: index => tiles.forEach((tile, offset) => tile.setAttribute('aria-pressed', String(offset === index))),
      remove,
    }
  }

  const pic = element('div', 'pcu-pic')
  picture(pic, top.card)
  const body = element('div', 'pcu-body')
  // One stat line: when, what, the number that says so, and the emote chat used most.
  const line = element('span', 'pcu-metrics', [momentClockDisplay(top.point).text, label(top), headlineNumber(top.point)].filter(Boolean).join(' · '))
  const emote = top.point.topEmotes.find(item => item.count > 0)
  if (emote) {
    const chip = element('span', 'pcu-top-emote')
    chip.title = burst(emote)
    const art = image(extensionEmoteImageUrls(emote, model.backendUrl), '')
    if (art) chip.append(art)
    chip.append(element('span', undefined, burst(emote)))
    line.append(' · ', chip)
  }
  body.append(element('span', 'pcu-rank', '#1 moment'), line)
  // With one game known, it is the stream's category, which
  // the page already shows and which need not be the one on screen then.
  if (top.game && model.namesGame) {
    const game = element('div', 'pcu-game')
    const art = image(top.game.art ? [top.game.art] : [], '')
    if (art) game.append(art)
    game.append(element('span', undefined, top.game.name))
    body.append(game)
  }
  const controls = element('div', 'pcu-actions')
  controls.append(button('▶ Jump', () => actions.jump(0), true))
  if (model.vodPage && best.length > 1) controls.append(watchButton(best, actions))
  body.append(controls)
  const hero = element('div', 'pcu-hero')
  hero.append(pic, body)

  const block = element('section', 'pcu')
  block.setAttribute('aria-label', 'Catch me up')
  if (facts) block.append(facts)
  block.append(hero)

  const minis = best.slice(1).map((moment, offset) => {
    const index = offset + 1
    const clock = momentClockDisplay(moment.point).text
    const mini = pickable(moment, index, 'pcu-mini')
    const thumb = element('span', 'pmf-thumb')
    thumb.setAttribute('aria-hidden', 'true')
    picture(thumb, moment.thumb)
    const text = element('span', 'pcu-mini-text')
    text.append(element('b', undefined, `#${index + 1} · ${clock}`), element('span', undefined, label(moment)))
    const emote = moment.point.topEmotes[0]
    if (emote && emote.count > 0) text.append(element('span', undefined, burst(emote)))
    mini.append(thumb, text)
    return mini
  })
  if (minis.length > 0) {
    const pair = element('div', 'pcu-pair')
    // Thumbnails show once one of them has a picture, as in Top Moments.
    pair.dataset.pmfList = 'true'
    pair.append(...minis)
    block.append(pair)
  }

  host.replaceChildren(block)
  return {
    select: index => minis.forEach((mini, offset) => mini.setAttribute('aria-pressed', String(offset + 1 === index))),
    remove,
  }
}

const api: CatchMeUpApi = { mount }

globalThis.__pulseCatchMeUp ??= api
window.dispatchEvent(new Event(CATCH_ME_UP_READY_EVENT))
