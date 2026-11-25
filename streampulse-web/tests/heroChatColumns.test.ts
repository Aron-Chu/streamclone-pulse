import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountChatColumns } from '../src/ui/components/landing/heroBackdrop/chatColumns'
import { failedEmotes, type Part } from '../src/ui/components/landing/heroBackdrop/shared'
import { HERO_EMOTES } from '../src/ui/components/landing/heroEmotes'
import { MADE_UP_CHAT, type ChatSource, type HeroMoment } from '../src/ui/components/landing/heroBackdropModel'

const SOURCES: ChatSource[] = [
  { name: 'Alpha_One', login: 'alpha_one', chatPerMin: 3000, viewers: 100, emoteShare: 0.5 },
  { name: 'Beta', login: 'beta', chatPerMin: 1000, viewers: 50, emoteShare: 0.2 },
]

const MOMENT: HeroMoment = { key: 'm1', name: 'Alpha_One', login: 'alpha_one', at: Date.now(), label: 'Chat', series: 'chat', short: '3.1×', emote: null }

const USERS = new Set(MADE_UP_CHAT.map((l) => l.user))

// jsdom lays nothing out: give each column the size it has at 1440 x 900 (288 px wide, 19 lines tall).
let host: HTMLElement
let stage: HTMLElement
let part: Part | null = null
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(288)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(459)
  stage = document.createElement('div')
  host = document.createElement('div')
  stage.appendChild(host)
  document.body.appendChild(stage)
})
afterEach(() => {
  part?.dispose()
  part = null
  stage.remove()
  failedEmotes.clear()
  vi.restoreAllMocks()
})

const chatLines = () => [...host.querySelectorAll<HTMLElement>('.sl-chatbg__line:not(.is-moment)')]

describe('hero side chat', () => {
  it('writes each line as plain text with a made-up name, and shows no name twice at once', () => {
    part = mountChatColumns(host, stage, SOURCES, false)
    const lines = chatLines()
    expect(lines.length).toBe(38)
    const shown = lines.map((ln) => ln.querySelector('b')?.textContent ?? '')
    for (const name of shown) expect(USERS.has(name.replace(/:$/, ''))).toBe(true)
    expect(new Set(shown).size).toBe(shown.length)
    for (const msg of host.querySelectorAll('.sl-chatbg__msg')) expect(msg.children.length).toBe(0)
  })

  it('shows words and no pictures under reduced motion', () => {
    part = mountChatColumns(host, stage, SOURCES, true)
    for (const ln of chatLines()) {
      expect(ln.querySelector('.sl-chatbg__msg')?.textContent).toBeTruthy()
      expect(ln.querySelector('img')).toBeNull()
    }
  })

  it('gives an emote-only line words when no emote can show', () => {
    for (const e of HERO_EMOTES) failedEmotes.add(e.name)
    part = mountChatColumns(host, stage, SOURCES, false)
    for (const ln of chatLines()) expect(ln.querySelector('.sl-chatbg__msg')?.textContent).toBeTruthy()
  })

  it('brings a new line within the first second', () => {
    part = mountChatColumns(host, stage, SOURCES, false)
    const before = chatLines().at(-1)
    part.tick(performance.now(), 0.95)
    expect(chatLines().at(-1)).not.toBe(before)
  })

  it("lights the searched channel's moment lines and leaves the made-up lines alone", () => {
    part = mountChatColumns(host, stage, SOURCES, false)
    part.moment(MOMENT, Date.now())
    part.search('input', 'alp')
    const moment = host.querySelector('.sl-chatbg__line.is-moment')
    expect(moment?.classList.contains('is-match')).toBe(true)
    for (const ln of chatLines()) expect(ln.className).toBe('sl-chatbg__line')
    // A moment that arrives while the search is open is lit too.
    part.moment({ ...MOMENT, key: 'm2' }, Date.now())
    expect(host.querySelectorAll('.sl-chatbg__line.is-match').length).toBe(2)
    part.search('blur', '')
    expect(host.querySelectorAll('.is-match').length).toBe(0)
  })
})
