import { MOMENT_FRAMES_CSS } from '@pulse-ext/content/momentFramesStyles.ts'
import blocksCave from './pictures/blocks-cave.svg?url'
import blocksDay from './pictures/blocks-day.svg?url'
import laugh from './pictures/laugh.svg?url'
import raid from './pictures/raid.svg?url'
import room from './pictures/room.svg?url'

/**
 * The demo's moment pictures (board P1, 2026-10-21): five drawn scenes, one per
 * top moment of the sample stream, shown in the panel's own picture slots.
 * On Twitch the moment-pictures script fills these slots from the player and
 * the VOD; the site has neither, so this stands in for it with the same slots
 * and styles, and says on each card that the picture is a drawn sample.
 */

/** Each scene at its moment's reaction onset (demoTape.json topMoments). */
const SCENES: ReadonlyArray<{ at: number; url: string }> = [
  { at: 1820, url: room },
  { at: 3080, url: laugh },
  { at: 5720, url: blocksDay },
  { at: 8300, url: blocksCave },
  { at: 9740, url: raid },
]

const READY_EVENT = 'pulse-moment-frames'
const styled = new WeakSet<Node>()

interface PictureView { kind: 'thumb' | 'card'; from: number; to: number; peak: number }

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function addStyles(host: HTMLElement): void {
  const root = host.getRootNode()
  if (styled.has(root)) return
  styled.add(root)
  const style = document.createElement('style')
  style.textContent = MOMENT_FRAMES_CSS
  ;(root instanceof ShadowRoot ? root : document.head).append(style)
}

function sceneFor(view: PictureView): { at: number; url: string } | null {
  let best: { at: number; url: string } | null = null
  for (const scene of SCENES) {
    if (scene.at < view.from - 30 || scene.at > view.to + 30) continue
    if (!best || Math.abs(scene.at - view.peak) < Math.abs(best.at - view.peak)) best = scene
  }
  return best
}

function markList(list: Element | null): void {
  list?.toggleAttribute('data-pmf-pictures', list.querySelector('.pmf-thumb[data-has]') != null)
}

function mount(host: HTMLElement, view: PictureView): () => void {
  addStyles(host)
  const scene = sceneFor(view)
  const list = view.kind === 'thumb' ? host.closest('[data-pmf-list]') : null
  if (!scene) {
    if (view.kind === 'thumb') host.title = 'No picture in the demo: only five moments have a drawn sample'
    return () => { host.title = '' }
  }
  const image = document.createElement('img')
  image.alt = ''
  image.decoding = 'async'
  image.src = scene.url
  if (view.kind === 'card') {
    const picture = document.createElement('div')
    picture.className = 'pmf-pic'
    picture.style.cursor = 'default'
    picture.setAttribute('role', 'img')
    picture.setAttribute('aria-label', `Picture at ${clock(scene.at)}: a drawn sample, not Twitch footage`)
    const chip = document.createElement('span')
    chip.className = 'pmf-chip'
    chip.textContent = 'Drawn sample'
    chip.style.setProperty('--pmf-dot', '#a1a1b2')
    picture.append(image, chip)
    host.toggleAttribute('data-top', true)
    host.replaceChildren(picture)
  } else {
    host.toggleAttribute('data-has', true)
    host.title = ''
    host.replaceChildren(image)
    markList(list)
  }
  return () => {
    host.removeAttribute('data-has')
    host.removeAttribute('data-top')
    host.replaceChildren()
    markList(list)
  }
}

/** Registers the stand-in where the panel looks for the moment-pictures script. */
export function installDemoMomentPictures(): boolean {
  const scope = globalThis as { __pulseMomentFrames?: unknown }
  if (!scope.__pulseMomentFrames) {
    scope.__pulseMomentFrames = {
      start: () => () => {},
      keep: () => {},
      mount,
      vod: async () => null,
    }
    dispatchEvent(new Event(READY_EVENT))
  }
  return true
}
