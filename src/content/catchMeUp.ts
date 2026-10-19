import { displayMomentReasonLabel, isEmoteSpikeReason, isViewerSpikeReason, momentClockDisplay, type LiveHeatEmote, type LiveHeatPoint } from '@streampulse/pulse-core'
import {
  CATCH_ME_UP_READY_EVENT,
  type CatchMeUpActions,
  type CatchMeUpApi,
  type CatchMeUpBlock,
  type CatchMeUpModel,
  type CatchMeUpMoment,
} from '../shared/catchMeUpContract.ts'
import { extensionEmoteImageUrls } from '../shared/emoteUrl.ts'
import type { MomentPictureView } from '../shared/momentFramesContract.ts'
import { formatMomentMetricsLine } from '../ui/momentActivity.ts'
import { formatCount } from '../ui/mostReacted.ts'
import { catchMeUpFacts } from './catchMeUpStory.ts'

/**
 * Entry of `content/catch-me-up.js`, injected by the worker into a Twitch tab
 * whose Pulse panel shows a stream recap (src/background/catchMeUpScript.ts),
 * so it never counts against the content script's size budget.
 *
 * It draws the top of the recap: one line of the stream's facts, the #1
 * moment with its picture, and the next two. Pictures are the
 * frames this tab captured while it played the stream; with none, the block
 * shows no picture rather than another one in its place.
 */

const CSS = `
.pcu{display:grid;gap:10px}
.pcu-head{margin:0;color:#e4e4ec;font-size:12px;font-weight:600;line-height:1.45;font-variant-numeric:tabular-nums}
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

function mount(host: HTMLElement, model: CatchMeUpModel, actions: CatchMeUpActions): CatchMeUpBlock {
  addStyles(host)
  const facts = catchMeUpFacts(model)
  const best = model.moments.slice(0, 3)
  const top = best[0]
  const frames = globalThis.__pulseMomentFrames
  const pictures: Array<() => void> = []
  const picture = (target: HTMLElement, view: MomentPictureView): void => {
    if (frames) pictures.push(frames.mount(target, view))
  }
  const remove = (): void => {
    pictures.splice(0).forEach(unmount => unmount())
    host.replaceChildren()
  }
  if (!top) {
    remove()
    return { select: () => {}, remove }
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
  // On a VOD page every jump seeks this player, so the best moments can be
  // watched in turn; each step waits for the viewer's click.
  if (model.vodPage && best.length > 1) {
    let next = 0
    const play = button('', () => {
      actions.jump(next)
      next = (next + 1) % best.length
      paint()
    })
    const paint = (): void => {
      play.textContent = next === 0
        ? `Watch best ${best.length}`
        : `Next: #${next + 1} · ${momentClockDisplay(best[next]!.point).text}`
    }
    paint()
    controls.append(play)
  }
  body.append(controls)
  const hero = element('div', 'pcu-hero')
  hero.append(pic, body)

  const block = element('section', 'pcu')
  block.setAttribute('aria-label', 'Catch me up')
  if (facts) block.append(element('p', 'pcu-head', facts))
  block.append(hero)

  const minis = best.slice(1).map((moment, offset) => {
    const index = offset + 1
    const clock = momentClockDisplay(moment.point).text
    const mini = element('button', 'pcu-mini')
    mini.type = 'button'
    mini.dataset.chartAction = 'true'
    mini.setAttribute('aria-pressed', 'false')
    mini.setAttribute('aria-label', `#${index + 1} moment at ${clock}, ${label(moment)}, ${formatMomentMetricsLine(moment.point)}`)
    const thumb = element('span', 'pmf-thumb')
    thumb.setAttribute('aria-hidden', 'true')
    picture(thumb, moment.thumb)
    const text = element('span', 'pcu-mini-text')
    text.append(element('b', undefined, `#${index + 1} · ${clock}`), element('span', undefined, label(moment)))
    const emote = moment.point.topEmotes[0]
    if (emote && emote.count > 0) text.append(element('span', undefined, burst(emote)))
    mini.append(thumb, text)
    mini.addEventListener('click', () => actions.pick(index))
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
