// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MomentPreview, type MomentContext } from './MomentPreview.tsx'
import type { MomentPresentation } from './MomentMedia.tsx'
import type { LibraryMoment } from './model.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
// jsdom does not implement native modal behavior; browser verification covers focus/Escape.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value() { this.setAttribute('open', '') } },
  close: { configurable: true, value() { this.removeAttribute('open') } },
})

const moment: LibraryMoment = { id: 'm', channel: 'fixturechan', title: 'Saved comeback', vodId: '2806037629', streamId: '123456789', offsetSeconds: 1812, availability: 'available', note: '', savedAt: 1 }
// Chat per minute, 10 minutes either side; the minute at +4 was never measured.
const chat = [112, 120, 98, 131, 140, 128, 150, 210, 260, 420, 1180, 690, 380, 260, null, 190, 170, 150, 160, 140, 130]
const context: MomentContext = {
  provenance: 'snapshot', capturedAt: 1, streamStartedAt: Date.UTC(2026, 9, 14, 19, 2), coverage: 'partial', windowLabel: '±10 min',
  samples: chat.map((messages, index) => ({ offsetSeconds: 1812 + (index - 10) * 60, messages })),
  selectedMessages: 1180, selectedEmotes: 1490, selectedViewers: 41230,
  topEmotes: [{ name: 'BAND', count: 447, provider: '7TV' }, { name: 'LUL', count: 268, provider: 'Twitch' }, { name: 'Clap', count: 121, provider: '7TV' }, { name: 'KEKW', count: 60, provider: 'FFZ' }],
}
const frame: MomentPresentation = { image: { url: 'https://example.com/frame.webp', sampledOffsetSeconds: 1810 }, analysisUrl: 'https://streampulse.stream/analytics/fixturechan/123456789#t=1812' }

let root: Root | undefined
let host: HTMLDivElement
async function render(props: { moment?: LibraryMoment; presentation?: MomentPresentation; ready?: boolean } = {}) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(<MomentPreview moment={props.moment ?? moment} context={props.ready === false ? { kind: 'loading' } : { kind: 'ready', value: context }}
    presentation={props.presentation} busy={false} error={null} onClose={() => {}} onSave={() => {}} onOpenLink={() => {}} />))
  return host.querySelector('dialog[open]')!
}
const buttons = (dialog: Element) => [...dialog.querySelectorAll('button')].map(button => button.textContent?.replace(/[^\x20-\x7e]/g, '').trim() || button.getAttribute('aria-label'))
const press = async (dialog: Element, text: string) => {
  const button = [...dialog.querySelectorAll('button')].find(b => b.textContent?.replace(/[^\x20-\x7e]/g, '').trim() === text)
  if (!button) throw new Error(`Missing button ${text}`)
  await act(async () => { button.click() })
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals() })

describe('Moment preview, around the moment', () => {
  it('shows the saved frame with its pill and the top emote over it', async () => {
    const dialog = await render({ presentation: frame })
    expect(dialog.getAttribute('aria-label')).toBe('Moment preview')
    expect(dialog.querySelector('.pl-around-pill')?.textContent).toBe('Saved frame · 00:30:10')
    expect(dialog.querySelector('.pl-around-over')?.textContent).toBe('BAND ×44700:30:12')
    expect(dialog.querySelector('.pl-around-frame img')?.getAttribute('src')).toBe('https://example.com/frame.webp')
    expect(dialog.textContent).not.toContain('not an archived copy')
    // With the frame showing the top emote, the chart's corner stays empty.
    expect(dialog.querySelectorAll('.pl-around-read span')).toHaveLength(1)
  })
  it('leaves the picture block out entirely without a frame', async () => {
    const dialog = await render({ presentation: { analysisUrl: frame.analysisUrl } })
    expect(dialog.querySelector('.pl-around-frame, .pl-around-pill, img')).toBeNull()
    expect(dialog.querySelector('.pl-around-head + .pl-around-body .pl-around-chart')).toBeTruthy()
    expect(dialog.querySelector('.pl-around-read span:last-child')?.textContent).toBe('BAND ×447')
  })
  it('drops a frame that fails to load', async () => {
    const dialog = await render({ presentation: frame })
    await act(async () => { dialog.querySelector('.pl-around-frame img')!.dispatchEvent(new Event('error')) })
    expect(dialog.querySelector('.pl-around-frame')).toBeNull()
  })
  it('heads with channel, stream date and time, and a gold bookmark', async () => {
    const dialog = await render()
    expect(dialog.querySelector('.pl-around-head small')?.textContent).toBe(`fixturechan · ${new Date(Date.UTC(2026, 9, 14, 19, 32, 12)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(new Date().getFullYear() === 2026 ? {} : { year: 'numeric' }) })} · 00:30:12`)
    expect(dialog.querySelector('h2')?.textContent).toBe('Saved comeback')
    expect(dialog.querySelector('button.pl-on')?.getAttribute('aria-label')).toBe('Remove bookmark: Saved comeback')
    expect(dialog.querySelector('button[aria-label="Close Moment preview"]')).toBeTruthy()
  })
  it('charts chat ±10 minutes: gaps stay gaps, the moment is highlighted and marked at its second', async () => {
    const dialog = await render()
    const bars = [...dialog.querySelectorAll('.pl-around-chart rect[data-minute]')]
    expect(bars).toHaveLength(20)
    expect(bars.map(bar => bar.getAttribute('data-minute'))).not.toContain('4')
    expect(bars.filter(bar => bar.getAttribute('fill')?.startsWith('url(')).map(bar => bar.getAttribute('data-minute'))).toEqual(['0'])
    // 12 s into the minute bar at index 10, 480 / 21 wide.
    expect(Number(dialog.querySelector('.pl-around-chart line')?.getAttribute('x1'))).toBeCloseTo((10 + 12 / 60) * 480 / 21)
    expect([...dialog.querySelectorAll('.pl-around-chart text')].map(label => label.textContent)).toEqual(['−10', '0', '+10'])
    const svg = dialog.querySelector('.pl-around-chart svg')!
    svg.getBoundingClientRect = () => ({ left: 0, width: 480, top: 0, height: 94, right: 480, bottom: 94, x: 0, y: 0, toJSON: () => ({}) })
    await act(async () => { svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 9.5 * 480 / 21 })) })
    expect(dialog.querySelector('.pl-around-read span')?.textContent).toBe('00:29 · 420 chat')
    await act(async () => { svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 14.5 * 480 / 21 })) })
    expect(dialog.querySelector('.pl-around-read span')?.textContent).toBe('00:34 · not measured')
  })
  it('shows the three tiles and the top three emotes as bars', async () => {
    const dialog = await render()
    expect([...dialog.querySelectorAll('.pl-around-tiles dt')].map(label => label.textContent)).toEqual(['Viewers', 'Chat / min', 'Emotes / min'])
    expect([...dialog.querySelectorAll('.pl-emote-usage')].map(usage => usage.textContent)).toEqual(['447/min · 30%', '268/min · 18%', '121/min · 8%'])
    expect((dialog.querySelector('.pl-emote-track i') as HTMLElement).style.width).toBe('30%')
    for (const text of ['Emote density', 'How these rates are measured', 'About emote usage']) expect(dialog.textContent).not.toContain(text)
  })
  it('offers Watch, Clip and Analysis, and hides Clip without a VOD id and Analysis without its link', async () => {
    let dialog = await render({ presentation: frame })
    expect(buttons(dialog.querySelector('.pl-around-actions')!)).toEqual(['Clip'])
    expect([...dialog.querySelectorAll('.pl-around-actions a')].map(link => link.textContent?.replace(/[^\x20-\x7e]/g, '').trim())).toEqual(['Watch', 'Analysis'])
    await act(async () => root?.unmount()); document.body.replaceChildren()
    dialog = await render({ moment: { ...moment, vodId: null, availability: 'unresolved' }, presentation: frame })
    expect(buttons(dialog.querySelector('.pl-around-actions')!)).toEqual(['Watch'])
    expect(dialog.textContent).not.toContain('Clip')
    await act(async () => root?.unmount()); document.body.replaceChildren()
    dialog = await render({ presentation: { image: frame.image } })
    expect(dialog.querySelector('.pl-around-actions a[href*="/analytics/"]')).toBeNull()
    expect(dialog.textContent).not.toContain('Analysis')
  })
  it('clips on Twitch: a window 30 s before the moment, moved and sized here, opened at its start', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const dialog = await render({ presentation: frame })
    await press(dialog, 'Clip')
    const link = () => dialog.querySelector<HTMLAnchorElement>('.pl-around-twitch')!
    expect(link().href).toBe('https://www.twitch.tv/videos/2806037629?t=0h29m42s')
    expect(link().target).toBe('_blank')
    expect(document.activeElement).toBe(link())
    expect(dialog.querySelector('.pl-around-start')?.textContent).toBe('00:29:4260 s')
    expect(dialog.textContent).toContain('Twitch makes the clip, up to 60 s.')
    // The tiles and emotes give way to the window's controls.
    expect(dialog.querySelector('.pl-around-tiles')).toBeNull()
    expect(dialog.querySelector('.pl-around-window')).toBeTruthy()
    await press(dialog, '+15 s')
    expect(link().href).toBe('https://www.twitch.tv/videos/2806037629?t=0h29m57s')
    await press(dialog, '30 s')
    expect(dialog.querySelector('button[aria-pressed="true"]')?.textContent).toBe('30 s')
    expect(dialog.querySelector('.pl-around-read')?.textContent).toBe('00:29:57 → 00:30:27 · click to move')
    // A chart click centres the window there, snapped to 5 s: 00:31:02 → starts 00:30:45.
    const svg = dialog.querySelector('.pl-around-chart svg')!
    svg.getBoundingClientRect = () => ({ left: 0, width: 480, top: 0, height: 94, right: 480, bottom: 94, x: 0, y: 0, toJSON: () => ({}) })
    await act(async () => { svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: (10 + 12 / 60 + 50 / 60) * 480 / 21 })) })
    expect(link().href).toBe('https://www.twitch.tv/videos/2806037629?t=0h30m45s')
    await press(dialog, 'Copy link')
    expect(writeText).toHaveBeenCalledWith('https://www.twitch.tv/videos/2806037629?t=0h30m45s')
    expect(dialog.textContent).toContain('Link copied.')
    await press(dialog, 'Cancel')
    expect(dialog.querySelector('.pl-around-twitch')).toBeNull()
    expect(dialog.querySelector('.pl-around-tiles')).toBeTruthy()
    expect(document.activeElement?.textContent?.replace(/[^\x20-\x7e]/g, '').trim()).toBe('Clip')
  })
  it('says the stats are loading instead of drawing an empty chart', async () => {
    const dialog = await render({ ready: false })
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe('Moment stats are loading.')
    expect(dialog.querySelector('.pl-around-chart, .pl-around-tiles')).toBeNull()
  })
})
