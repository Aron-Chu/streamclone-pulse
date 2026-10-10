// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CHAT_BADGES_STYLE_ID,
  CHAT_PAINT_STOPS,
  ChatBadgeDecorator,
  MAX_LINES_PER_CALLBACK,
  buildChatBadgeIndex,
  chatBadgeCss,
  decorateLine,
  lineAuthor,
  locateChat,
  undecorate,
} from '../src/content/chatBadgeDom.ts'
import { FIXTURE_LIST, FIXTURE_PEOPLE, chatContainer, chatLine, type ChatFixtureStyle } from './fixtures/chat-badges/chatMarkup.ts'

const root = resolve(__dirname, '..')
const STYLES: ChatFixtureStyle[] = ['native', 'bttv', 'ffz', '7tv']

function mount(style: ChatFixtureStyle, people = FIXTURE_PEOPLE) {
  document.documentElement.className = 'tw-root--theme-dark'
  document.body.innerHTML = `<div class="chat-column">${chatContainer(style, people.map(person => chatLine(style, person)).join(''))}</div>`
  return locateChat(document)!
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = '' })

describe('Seen in chat decorator: matching and placement per chat style', () => {
  for (const style of STYLES) {
    it(`${style}: crest after the existing badges and before the name, paint on the name, listed people only`, () => {
      const { container, style: located } = mount(style)
      expect(located).toBe(style === '7tv' ? '7tv' : 'native')
      const index = buildChatBadgeIndex(FIXTURE_LIST)
      const before = container.innerHTML
      const lines = [...container.querySelectorAll(style === '7tv' ? '.seventv-message' : '.chat-line__message')]
      expect(lines).toHaveLength(FIXTURE_PEOPLE.length)
      const hits = lines.map(line => decorateLine(line, located, index))
      expect(hits).toEqual([true, false, true, true, false, true])
      const crests = [...container.querySelectorAll<HTMLElement>('.sp-cb-crest')]
      expect(crests.map(crest => crest.dataset.t)).toEqual(['3', '2', '4', '0'])
      expect(crests[0].getAttribute('role')).toBe('img')
      expect(crests[0].getAttribute('aria-label')).toBe('StreamPulse Supporter, 12 months')
      expect(crests[3].getAttribute('title')).toBe('StreamPulse Supporter · new')
      for (const crest of crests) {
        const line = crest.closest(style === '7tv' ? '.seventv-message' : '.chat-line__message')!
        const name = line.querySelector(style === '7tv' ? '.seventv-chat-user-username' : '.chat-author__display-name')!
        // Never inside another badge; always before the name in document order.
        expect(crest.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(crest.closest('button, .ffz-badge')).toBeNull()
        const otherBadge = line.querySelector('.chat-badge, .ffz-badge, .seventv-chat-badge')
        if (otherBadge) expect(otherBadge.compareDocumentPosition(crest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
      const painted = [...container.querySelectorAll<HTMLElement>('[data-sp-paint]')]
      // crest_new has no finish equipped (paint 0): crest only, no paint.
      expect(painted.map(name => [name.textContent, name.dataset.spPaint, name.dataset.spWave])).toEqual([
        ['Crest_Glass', '1', '0'], ['crest_etched', '2', '1'], ['Crest_Halo', '3', '3'],
      ])
      // Twitch's own colour stays on the element untouched.
      for (const name of painted) expect(name.getAttribute('style') ?? name.parentElement?.getAttribute('style')).toMatch(/color/)
      // Teardown restores the markup byte for byte.
      undecorate(container)
      expect(container.innerHTML).toBe(before)
    })
  }

  it('real captured Twitch markup: the native selectors find the line, the login and the anchors', () => {
    const captured = readFileSync(resolve(root, 'tests/fixtures/chat-badges/captured-native-2026-10-09.html'), 'utf8')
    document.body.innerHTML = captured
    const found = locateChat(document)!
    expect(found.style).toBe('native')
    expect(found.container.getAttribute('role')).toBe('log')
    // Lines are two wrapper divs below the container's children; the welcome line is not a chat line.
    const lines = [...found.container.children].map(child => child.querySelector('.chat-line__message')).filter(Boolean) as Element[]
    expect(lines.map(line => lineAuthor(line, 'native'))).toEqual([{ id: null, login: 'crest_glass' }, { id: null, login: 'plainviewer' }])
    const before = found.container.innerHTML
    expect(decorateLine(lines[0], 'native', buildChatBadgeIndex(FIXTURE_LIST))).toBe(true)
    const crest = lines[0].querySelector('.sp-cb-crest')!
    expect(crest.nextElementSibling?.className).toBe('chat-line__username')
    expect(crest.previousElementSibling?.querySelector('.chat-badge')).not.toBeNull()
    expect(lines[0].querySelector('.chat-author__display-name')?.getAttribute('data-sp-paint')).toBe('1')
    undecorate(found.container)
    expect(found.container.innerHTML).toBe(before)
  })

  it('a user ID beats the login where the markup has one (FFZ); a renamed login is matched by ID', () => {
    mount('ffz', [{ login: 'renamed_now', display: 'Renamed_Now', id: '10000001' }])
    const line = document.querySelector('.chat-line__message')!
    expect(lineAuthor(line, 'native')).toEqual({ id: '10000001', login: 'renamed_now' })
    expect(decorateLine(line, 'native', buildChatBadgeIndex(FIXTURE_LIST))).toBe(true)
    // Same login on a different user ID: ID wins, so the login entry does not apply.
    mount('ffz', [{ login: 'crest_glass', id: '99999999' }])
    expect(decorateLine(document.querySelector('.chat-line__message')!, 'native', buildChatBadgeIndex(FIXTURE_LIST))).toBe(true)
  })

  it('localized display names match by login; names 7TV already paints keep their 7TV paint', () => {
    mount('native', [{ login: 'crest_glass', display: '水晶' }])
    const nativeLine = document.querySelector('.chat-line__message')!
    nativeLine.removeAttribute('data-a-user')
    nativeLine.querySelector('[data-a-user]')!.removeAttribute('data-a-user')
    expect(lineAuthor(nativeLine, 'native').login).toBe('crest_glass')
    mount('7tv', [{ login: 'crest_glass', display: '水晶 (crest_glass)' }, { login: 'crest_halo', display: 'Crest_Halo', sevenTvPaint: true }, { login: 'nobody', display: '名前' }])
    const lines = [...document.querySelectorAll('.seventv-message')]
    expect(lines.map(line => lineAuthor(line, '7tv').login)).toEqual(['crest_glass', 'crest_halo', null])
    const index = buildChatBadgeIndex(FIXTURE_LIST)
    expect(lines.map(line => decorateLine(line, '7tv', index))).toEqual([true, true, false])
    expect(lines[1].querySelector('.sp-cb-crest')).not.toBeNull()
    expect(lines[1].querySelector('[data-sp-paint]')).toBeNull()
  })

  it('duplicate logins (a rename during the refresh lag) are matched by neither', () => {
    const index = buildChatBadgeIndex([['1', 'same', 1, 1, 0], ['2', 'same', 2, 2, 0], ['3', 'solo', 0, 0, 0]])
    expect(index.byLogin.has('same')).toBe(false)
    expect(index.byId.get('2')).toBe(2 | 2 << 3)
    expect(index.byLogin.get('solo')).toBe(0)
  })

  it('re-decorating a line is idempotent: one crest, same attributes', () => {
    mount('native')
    const line = document.querySelector('.chat-line__message')!
    const index = buildChatBadgeIndex(FIXTURE_LIST)
    decorateLine(line, 'native', index)
    const once = line.outerHTML
    decorateLine(line, 'native', index)
    expect(line.outerHTML).toBe(once)
    expect(line.querySelectorAll('.sp-cb-crest')).toHaveLength(1)
  })
})

describe('Seen in chat decorator: one observer, live chat', () => {
  for (const style of STYLES) {
    it(`${style}: decorates lines already there and new lines as they arrive; stop() leaves Twitch's DOM as it was`, async () => {
      const { container } = mount(style, FIXTURE_PEOPLE.slice(0, 2))
      const pristine = document.body.innerHTML
      const decorator = new ChatBadgeDecorator(document)
      decorator.setList(FIXTURE_LIST)
      decorator.start()
      expect(document.getElementById(CHAT_BADGES_STYLE_ID)).not.toBeNull()
      expect(container.querySelectorAll('.sp-cb-crest')).toHaveLength(1)
      const template = document.createElement('template')
      template.innerHTML = FIXTURE_PEOPLE.slice(2).map(person => chatLine(style, person)).join('')
      container.append(...template.content.childNodes)
      await flush()
      expect(container.querySelectorAll('.sp-cb-crest')).toHaveLength(4)
      expect(decorator.snapshot()).toMatchObject({ lines: 6, hits: 4, attached: true, style: style === '7tv' ? '7tv' : 'native' })
      decorator.stop()
      expect(document.getElementById(CHAT_BADGES_STYLE_ID)).toBeNull()
      // Remove the lines added during the test: what remains is exactly the original markup.
      const appended = [...container.children].slice(2)
      for (const node of appended) node.remove()
      expect(document.body.innerHTML).toBe(pristine)
    })
  }

  it('a new list re-matches the lines on screen; an empty list removes every crest', async () => {
    const { container } = mount('native')
    const decorator = new ChatBadgeDecorator(document)
    decorator.setList(FIXTURE_LIST)
    decorator.start()
    expect(container.querySelectorAll('.sp-cb-crest')).toHaveLength(4)
    decorator.setList([['10000002', 'plainviewer', 1, 0, 0]])
    expect([...container.querySelectorAll('.sp-cb-crest')].map(crest => crest.closest('.chat-line__message')!.getAttribute('data-a-user'))).toEqual(['plainviewer'])
    decorator.setList([])
    expect(container.querySelectorAll('.sp-cb-crest')).toHaveLength(0)
    decorator.stop()
  })

  it('a burst larger than one callback is finished in the next task, not dropped', async () => {
    const { container } = mount('native', [])
    const decorator = new ChatBadgeDecorator(document)
    decorator.setList(FIXTURE_LIST)
    decorator.start()
    const template = document.createElement('template')
    template.innerHTML = Array.from({ length: MAX_LINES_PER_CALLBACK + 50 }, () => chatLine('native', FIXTURE_PEOPLE[0])).join('')
    container.append(...template.content.childNodes)
    await Promise.resolve()
    await flush()
    await flush()
    expect(container.querySelectorAll('.sp-cb-crest')).toHaveLength(MAX_LINES_PER_CALLBACK + 50)
    decorator.stop()
  })

  it('re-attaches when the page swaps the chat container (SPA navigation, 7TV loading late)', async () => {
    mount('native')
    const decorator = new ChatBadgeDecorator(document)
    decorator.setList(FIXTURE_LIST)
    decorator.start()
    document.body.innerHTML = `<div>${chatContainer('7tv', FIXTURE_PEOPLE.map(person => chatLine('7tv', person)).join(''))}</div>`
    decorator.attach()
    expect(decorator.snapshot().style).toBe('7tv')
    expect(document.querySelectorAll('.seventv-chat-list .sp-cb-crest')).toHaveLength(4)
    decorator.stop()
  })
})

describe('Seen in chat stylesheet', () => {
  it('is still by default; motion adds only a slow Aurora drift, and reduced motion always removes it', () => {
    const still = chatBadgeCss(false)
    expect(still).not.toMatch(/animation\s*:\s*sp-cb/)
    expect(still).not.toMatch(/@keyframes/)
    expect(still).toContain('@media (prefers-reduced-motion:reduce)')
    expect(still).not.toMatch(/::after|data-sheen/)
    const moving = chatBadgeCss(true)
    expect(moving).toMatch(/\[data-sp-wave="3"\]\{animation:sp-cb-drift 12s ease-in-out infinite alternate\}/)
    expect(moving.indexOf('prefers-reduced-motion')).toBeGreaterThan(moving.indexOf('sp-cb-drift'))
    // Twitch's inline colour is never overridden: text fill only.
    expect(still).not.toMatch(/(^|[^-])color\s*:/)
    // Five crests, the same art as the header crest.
    expect(still.match(/\.sp-cb-crest\[data-t="\d"\]/g)).toHaveLength(5)
  })

  it('every paint stop has at least 3:1 contrast on Twitch chat in both themes', () => {
    const luminance = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      return [n >> 16, n >> 8 & 255, n & 255].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
    }
    const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
    for (const [theme, backgrounds] of [['dark', ['#18181b', '#0e0e10']], ['light', ['#ffffff', '#f7f7f8']]] as const) {
      for (const stops of Object.values(CHAT_PAINT_STOPS[theme])) {
        for (const stop of stops) for (const bg of backgrounds) expect(contrast(stop, bg), `${theme} ${stop} on ${bg}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('Seen in chat decorator: static guarantees', () => {
  it('never reads layout or writes HTML strings (no forced reflow, no injected markup)', () => {
    const files = readdirSync(resolve(root, 'src/content')).filter(file => /^chatBadge/.test(file))
    expect(files.sort()).toEqual(['chatBadgeDom.ts', 'chatBadges.ts'])
    for (const file of files) {
      const source = readFileSync(resolve(root, 'src/content', file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(source, file).not.toMatch(/getBoundingClientRect|offset[A-Z]|client[A-Z]|scroll[A-Z]|getComputedStyle|innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
      // Nothing to Twitch: no fetch, no GQL, no cookies or page storage.
      expect(source, file).not.toMatch(/\bfetch\(|gql|document\.cookie|localStorage|sessionStorage|postMessage/)
    }
  })
})
