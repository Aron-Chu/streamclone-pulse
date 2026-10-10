import { SUPPORTER_TENURES, supporterCrestCssUrl } from '../shared/supporterPaint.ts'
import type { ChatBadgeEntry } from '../shared/chatBadges.ts'

/**
 * Seen in chat, DOM side: find Twitch's chat, match a chat line's author
 * against the Supporter list, and add a crest and paint.
 *
 * Scoped exception to "we never mutate Twitch's DOM" (owner decision D3): this
 * module only ADDS its own `<span class="sp-cb-crest">` and two `data-sp-*`
 * attributes inside chat lines. It never removes, moves or edits Twitch's
 * nodes, text, classes or inline styles, and `undecorate` restores the DOM
 * exactly. It reads no layout (a static test bans layout reads and innerHTML
 * in these files), never inserts list strings into the page, and only reads
 * attributes and text Twitch, FFZ, BTTV and 7TV already put on each line.
 *
 * Selector tables are ordered and were checked against captured markup
 * (tests/fixtures/chat-badges/*.html; native captured 2026-10-09 from a public
 * channel's popout chat).
 */

export type ChatStyle = 'native' | '7tv'

/** Message containers, most specific first: 7TV replaces Twitch's list with its own. */
export const CHAT_CONTAINERS: ReadonlyArray<readonly [string, ChatStyle]> = [
  ['.seventv-chat-list', '7tv'],
  ['[data-test-selector="chat-scrollable-area__message-container"]', 'native'],
  ['.chat-scrollable-area__message-container', 'native'],
]

/** One chat line per style. BTTV decorates native lines; FFZ renders its own with the same class. */
export const CHAT_LINE: Record<ChatStyle, string> = {
  native: '.chat-line__message',
  '7tv': '.seventv-message',
}

const LOGIN = /^[a-z0-9_]{1,25}$/
const DISPLAY_LOGIN = /^[A-Za-z0-9_]{1,25}$/
const INTL_LOGIN = /\(([A-Za-z0-9_]{1,25})\)\s*$/
const USER_ID = /^[1-9][0-9]{0,19}$/

export function locateChat(root: ParentNode): { container: Element; style: ChatStyle } | null {
  for (const [selector, style] of CHAT_CONTAINERS) {
    const container = root.querySelector(selector)
    if (container) return { container, style }
  }
  return null
}

/** code = tier | paint << 3 | wave << 5. */
export interface ChatBadgeIndex { byId: Map<string, number>; byLogin: Map<string, number>; size: number }

export function buildChatBadgeIndex(entries: readonly ChatBadgeEntry[]): ChatBadgeIndex {
  const byId = new Map<string, number>()
  const byLogin = new Map<string, number>()
  const duplicate = new Set<string>()
  for (const [id, login, tier, paint, wave] of entries) {
    const code = tier | paint << 3 | wave << 5
    byId.set(id, code)
    // Two IDs with one login (a rename during the refresh lag): neither is matched by login.
    if (byLogin.has(login)) duplicate.add(login)
    else byLogin.set(login, code)
  }
  for (const login of duplicate) byLogin.delete(login)
  return { byId, byLogin, size: entries.length }
}

function loginFrom(value: string | null | undefined): string | null {
  if (!value) return null
  const lower = value.toLowerCase()
  return LOGIN.test(lower) ? lower : null
}

/**
 * The author of a line: a Twitch user ID where the markup exposes one (FFZ),
 * else the login. Native Twitch keeps the ID only in React props in the page's
 * own world, which this never reads.
 */
export function lineAuthor(line: Element, style: ChatStyle): { id: string | null; login: string | null } {
  const rawId = line.getAttribute('data-user-id')
  const id = rawId && USER_ID.test(rawId) ? rawId : null
  if (style === 'native') {
    let login = loginFrom(line.getAttribute('data-a-user')) ?? loginFrom(line.getAttribute('data-user'))
    if (!login) {
      const name = line.querySelector('[data-a-target="chat-message-username"]')
      login = loginFrom(name?.getAttribute('data-a-user'))
      if (!login) {
        const intl = line.querySelector('.chat-author__intl-login')?.textContent
        const match = intl ? INTL_LOGIN.exec(intl) : null
        login = loginFrom(match?.[1])
      }
    }
    return { id, login }
  }
  const text = line.querySelector('.seventv-chat-user-username')?.textContent?.trim() ?? ''
  const intl = INTL_LOGIN.exec(text)
  return { id, login: intl ? loginFrom(intl[1]) : DISPLAY_LOGIN.test(text) ? loginFrom(text) : null }
}

export function lookupAuthor(index: ChatBadgeIndex, author: { id: string | null; login: string | null }): number | undefined {
  if (author.id !== null) {
    const byId = index.byId.get(author.id)
    if (byId !== undefined) return byId
  }
  return author.login !== null ? index.byLogin.get(author.login) : undefined
}

const CREST_LABELS = SUPPORTER_TENURES.map(option => option.id === 'new' ? 'new' : option.label)

/** Adds the crest and paint to one line. Returns true when the author is on the list. */
export function decorateLine(line: Element, style: ChatStyle, index: ChatBadgeIndex): boolean {
  const code = lookupAuthor(index, lineAuthor(line, style))
  if (code === undefined) return false
  const tier = code & 7
  const paint = code >> 3 & 3
  const wave = code >> 5 & 3
  const doc = line.ownerDocument
  if (!line.querySelector('.sp-cb-crest')) {
    const crest = doc.createElement('span')
    crest.className = 'sp-cb-crest'
    crest.setAttribute('data-t', String(tier))
    crest.setAttribute('role', 'img')
    const label = CREST_LABELS[tier] ?? 'new'
    crest.setAttribute('aria-label', `StreamPulse Supporter, ${label}`)
    crest.setAttribute('title', `StreamPulse Supporter · ${label}`)
    if (style === 'native') {
      const ffzBadges = line.querySelector('.chat-line__message--badges')
      const username = line.querySelector('.chat-line__username')
      if (ffzBadges) ffzBadges.append(crest)
      else if (username?.parentNode) username.parentNode.insertBefore(crest, username)
    } else {
      const badges = line.querySelector('.seventv-chat-user-badge-list')
      const username = line.querySelector('.seventv-chat-user-username')
      if (badges) badges.append(crest)
      else if (username?.parentNode) username.parentNode.insertBefore(crest, username)
    }
  }
  if (paint > 0) {
    const name = style === 'native'
      ? line.querySelector('.chat-author__display-name')
      : line.querySelector('.seventv-chat-user-username')
    // A name 7TV already paints keeps its 7TV paint; the crest still shows.
    const painted = style === '7tv' && name && (name.querySelector('.seventv-painted-content') || /background-image/.test(name.getAttribute('style') ?? ''))
    if (name && !painted) {
      name.setAttribute('data-sp-paint', String(paint))
      name.setAttribute('data-sp-wave', String(wave))
    }
  }
  return true
}

/** Removes everything this module added under `root`. */
export function undecorate(root: ParentNode): void {
  for (const crest of Array.from(root.querySelectorAll('.sp-cb-crest'))) crest.remove()
  for (const name of Array.from(root.querySelectorAll('[data-sp-paint]'))) {
    name.removeAttribute('data-sp-paint')
    name.removeAttribute('data-sp-wave')
  }
}

/**
 * Paint stops per finish. Dark chat uses the overlay's own paint; light chat
 * uses darker stops, each at least 3:1 on Twitch's light chat (tests pin it).
 */
export const CHAT_PAINT_STOPS = {
  dark: { 1: ['#78dce8', '#a5b4fc', '#2fa4b8', '#e3f8fb'], 2: ['#efc96a', '#fff1c2', '#a87420', '#fdf4dc'], 3: ['#e6a9d6', '#c4b5fd', '#fcb69f', '#fbeaf6'] },
  light: { 1: ['#0e7490', '#4f46e5', '#155e75', '#0f766e'], 2: ['#92400e', '#a16207', '#78350f', '#854d0e'], 3: ['#be185d', '#7c3aed', '#c2410c', '#9d174d'] },
} as const

const N = 'span[data-sp-paint]'

/**
 * The chunk's one stylesheet. Still by default: waves are static gradients and
 * no sheen is drawn in chat. "Animate paints in chat" adds only a slow Aurora
 * drift, and reduced motion always removes it.
 */
export function chatBadgeCss(motion: boolean): string {
  const crests = SUPPORTER_TENURES.map(({ id }, tier) => `.sp-cb-crest[data-t="${tier}"]{background-image:${supporterCrestCssUrl(id)}}`).join('')
  const stops = (theme: 'dark' | 'light', prefix: string) => ([1, 2, 3] as const)
    .map(paint => { const [a, b, c, d] = CHAT_PAINT_STOPS[theme][paint]; return `${prefix}${N}[data-sp-paint="${paint}"]{--sp-a:${a};--sp-b:${b};--sp-c:${c};--sp-d:${d}}` })
    .join('')
  return '.sp-cb-crest{display:inline-block;width:18px;height:18px;vertical-align:middle;margin:0 3px 2px 0;background:center/contain no-repeat}'
    + crests
    + `${N}{-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;background-image:linear-gradient(100deg,var(--sp-a),var(--sp-b) 40%,var(--sp-a) 68%,var(--sp-c))}`
    + stops('dark', '')
    + stops('light', 'html.tw-root--theme-light ')
    + `${N}[data-sp-wave="1"]{background-image:repeating-linear-gradient(100deg,var(--sp-a) 0,var(--sp-b) .16em,var(--sp-c) .34em,var(--sp-a) .5em)}`
    + `${N}[data-sp-wave="2"]{background-image:linear-gradient(180deg,var(--sp-d) 0%,var(--sp-a) 47%,var(--sp-c) 53%,var(--sp-b) 100%)}`
    + `${N}[data-sp-wave="3"]{background-image:linear-gradient(90deg,var(--sp-a),var(--sp-b),var(--sp-c),var(--sp-b),var(--sp-a));background-size:300% 100%;background-position:50% 0}`
    + (motion ? `${N}[data-sp-wave="3"]{animation:sp-cb-drift 12s ease-in-out infinite alternate}@keyframes sp-cb-drift{from{background-position:0 0}to{background-position:100% 0}}` : '')
    + `@media (prefers-reduced-motion:reduce){${N},.sp-cb-crest{animation:none!important}}`
}

export const CHAT_BADGES_STYLE_ID = 'streampulse-chat-badges'
/** Lines handled synchronously per observer callback; the rest wait for the next task. */
export const MAX_LINES_PER_CALLBACK = 300
const SAMPLE_RING = 1024

export interface ChatBadgeStats {
  lines: number
  hits: number
  callbacks: number
  totalMs: number
  maxMs: number
  samples: number[]
  style: ChatStyle | null
  attached: boolean
}

/**
 * One MutationObserver on the located message container (childList, no
 * subtree): new lines are decorated in the observer's microtask, before the
 * browser paints them, so there is no flash and no second layout.
 */
export class ChatBadgeDecorator {
  private index: ChatBadgeIndex = buildChatBadgeIndex([])
  private container: Element | null = null
  private style: ChatStyle | null = null
  private observer: MutationObserver | null = null
  private processed = new WeakSet<Element>()
  private backlog: Element[] = []
  private backlogTimer: ReturnType<typeof setTimeout> | null = null
  private watchTimer: ReturnType<typeof setInterval> | null = null
  private styleElement: HTMLStyleElement | null = null
  private motion = false
  private running = false
  private stats = { lines: 0, hits: 0, callbacks: 0, totalMs: 0, maxMs: 0, ring: new Float64Array(SAMPLE_RING), next: 0 }

  constructor(private doc: Document) {}

  get active(): boolean { return this.running }

  setMotion(motion: boolean): void {
    this.motion = motion
    if (this.styleElement) this.styleElement.textContent = chatBadgeCss(motion)
  }

  /** A new list: re-match every line on screen. */
  setList(entries: readonly ChatBadgeEntry[]): void {
    this.index = buildChatBadgeIndex(entries)
    if (!this.running) return
    if (this.container) {
      undecorate(this.container)
      this.processed = new WeakSet()
      this.queue(Array.from(this.container.children))
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    if (!this.styleElement) {
      const element = this.doc.createElement('style')
      element.id = CHAT_BADGES_STYLE_ID
      element.textContent = chatBadgeCss(this.motion)
      ;(this.doc.head ?? this.doc.documentElement).append(element)
      this.styleElement = element
    }
    this.attach()
    // Re-find the container after SPA navigation or a 7TV/FFZ swap: one
    // querySelector every 2 s, and nothing at all while the tab is hidden.
    this.watchTimer = setInterval(() => { if (!this.doc.hidden) this.attach() }, 2_000)
  }

  /** Disconnects and removes every crest, attribute and the stylesheet. */
  stop(): void {
    this.running = false
    this.observer?.disconnect()
    this.observer = null
    if (this.watchTimer !== null) clearInterval(this.watchTimer)
    if (this.backlogTimer !== null) clearTimeout(this.backlogTimer)
    this.watchTimer = null
    this.backlogTimer = null
    this.backlog = []
    this.container = null
    this.style = null
    this.processed = new WeakSet()
    this.styleElement?.remove()
    this.styleElement = null
    undecorate(this.doc)
  }

  snapshot(): ChatBadgeStats {
    const count = Math.min(this.stats.callbacks, SAMPLE_RING)
    return {
      lines: this.stats.lines, hits: this.stats.hits, callbacks: this.stats.callbacks,
      totalMs: this.stats.totalMs, maxMs: this.stats.maxMs,
      samples: Array.from(this.stats.ring.subarray(0, count)),
      style: this.style, attached: this.container !== null,
    }
  }

  /** Attach to the best container if it changed. */
  attach(): void {
    if (!this.running) return
    const found = locateChat(this.doc)
    if (found?.container === this.container) return
    this.observer?.disconnect()
    this.observer = null
    this.container = found?.container ?? null
    this.style = found?.style ?? null
    if (!found) return
    this.observer = new MutationObserver(records => this.onMutations(records))
    this.observer.observe(found.container, { childList: true })
    this.queue(Array.from(found.container.children))
  }

  private onMutations(records: MutationRecord[]): void {
    const started = performance.now()
    const added: Element[] = []
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) if (node.nodeType === 1) added.push(node as Element)
    }
    this.queue(added)
    const spent = performance.now() - started
    const stats = this.stats
    stats.callbacks += 1
    stats.totalMs += spent
    if (spent > stats.maxMs) stats.maxMs = spent
    stats.ring[stats.next] = spent
    stats.next = (stats.next + 1) % SAMPLE_RING
  }

  private queue(nodes: Element[]): void {
    const now = nodes.slice(0, MAX_LINES_PER_CALLBACK)
    for (const node of now) this.process(node)
    if (nodes.length > now.length) {
      this.backlog.push(...nodes.slice(now.length))
      this.drainLater()
    }
  }

  private drainLater(): void {
    if (this.backlogTimer !== null) return
    this.backlogTimer = setTimeout(() => {
      this.backlogTimer = null
      const slice = this.backlog.splice(0, MAX_LINES_PER_CALLBACK)
      for (const node of slice) if (node.isConnected) this.process(node)
      if (this.backlog.length) this.drainLater()
    }, 0)
  }

  private process(node: Element): void {
    const style = this.style
    if (!style || this.index.size === 0) return
    const selector = CHAT_LINE[style]
    const line = node.matches(selector) ? node : node.querySelector(selector)
    if (!line || this.processed.has(line)) return
    this.processed.add(line)
    this.stats.lines += 1
    if (decorateLine(line, style, this.index)) this.stats.hits += 1
  }
}
