/**
 * Chat line markup for the Seen in chat decorator, one builder per chat style.
 *
 * - native: copied from Twitch's popout chat on a public channel on
 *   2026-10-09 (logged out, nothing sent; see captured-native-2026-10-09.html),
 *   with logins, names, messages and badge images replaced.
 * - bttv: native lines plus BTTV's additions (its badge image beside Twitch's).
 * - ffz: FrankerFaceZ's own line render (data-user-id / data-user on the line,
 *   `.chat-line__message--badges`).
 * - 7tv: 7TV's chat list (`.seventv-chat-list` / `.seventv-message`), with and
 *   without a 7TV paint on the name.
 *
 * BTTV, FFZ and 7TV were written from their published markup, not captured:
 * agents do not install third-party extensions. The owner's real-browser pass
 * (spec §11.5) re-captures them before launch; the selectors in
 * src/content/chatBadgeDom.ts fail quiet (no match, no crest) if they drift.
 */
export type ChatFixtureStyle = 'native' | 'bttv' | 'ffz' | '7tv'

export interface ChatFixtureLine {
  login: string
  display?: string
  id?: string
  text?: string
  color?: string
  /** Show a Twitch badge before the name (Prime). */
  badge?: boolean
  /** 7TV only: the name already wears a 7TV paint. */
  sevenTvPaint?: boolean
}

const BADGE_SRC = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 18 18%22%3E%3Crect width=%2218%22 height=%2218%22 rx=%224%22 fill=%22%2300a2ff%22/%3E%3C/svg%3E'
const BTTV_SRC = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 18 18%22%3E%3Ccircle cx=%229%22 cy=%229%22 r=%229%22 fill=%22%23d50014%22/%3E%3C/svg%3E'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function nativeLine(line: ChatFixtureLine, bttv: boolean): string {
  const display = escapeHtml(line.display ?? line.login)
  const text = escapeHtml(line.text ?? 'That deserves a clip.')
  const color = line.color ?? 'rgb(49, 154, 36)'
  const badges = (line.badge ? `<div class="InjectLayout-sc-1i43xsx-0 bvEAgn"><button data-a-target="chat-badge"><img alt="Prime" aria-label="Prime badge" class="chat-badge" src="${BADGE_SRC}"></button></div>` : '')
    + (bttv ? `<img alt="BTTV" class="chat-badge bttv-chat-badge" src="${BTTV_SRC}">` : '')
  const intl = line.display && line.display.toLowerCase() !== line.login ? `<span class="chat-author__intl-login"> (${line.login})</span>` : ''
  return `<div class="Layout-sc-1xcs6mc-0"><div class="Layout-sc-1xcs6mc-0"><div class="chat-line__message" aria-label="${display}: ${text}" tabindex="0" data-a-target="chat-line-message" data-a-user="${line.login}"><div class="Layout-sc-1xcs6mc-0 glFavL"><div class="Layout-sc-1xcs6mc-0 jvJYGy chat-line__message-highlight"></div><div class="Layout-sc-1xcs6mc-0 glFavL chat-line__message-container"><div class="Layout-sc-1xcs6mc-0"></div><div class="Layout-sc-1xcs6mc-0"><div class="Layout-sc-1xcs6mc-0 kBZhWz chat-line__no-background"><div class="Layout-sc-1xcs6mc-0 iinBYO"><div class="Layout-sc-1xcs6mc-0 bDKKrF chat-line__username-container chat-line__username-container--hoverable"><span>${badges}</span><span class="chat-line__username" role="button" tabindex="0"><span><span class="chat-author__display-name" data-a-target="chat-message-username" data-a-user="${line.login}" data-test-selector="message-username" style="color: ${color};">${display}</span>${intl}</span></span></div><span aria-hidden="true">: </span><span class="" data-a-target="chat-line-message-body" dir="auto"><span class="text-fragment" data-a-target="chat-message-text">${text}</span></span></div></div></div></div></div></div></div></div>`
}

function ffzLine(line: ChatFixtureLine): string {
  const display = escapeHtml(line.display ?? line.login)
  const text = escapeHtml(line.text ?? 'That deserves a clip.')
  const color = line.color ?? '#8a2be2'
  const badge = line.badge ? `<span class="ffz-badge" data-badge="premium" data-provider="twitch" style="background-image: url(&quot;${BADGE_SRC}&quot;);"></span>` : ''
  const id = line.id ? ` data-user-id="${line.id}"` : ''
  return `<div class="chat-line__message" data-room-id="11111111" data-room="fixturechan"${id} data-user="${line.login}" data-a-target="chat-line-message" tabindex="0"><div class="chat-line__message-highlight ffz--highlight"></div><div class="chat-line__message-container tw-relative"><span class="chat-line__message--badges">${badge}</span><span class="chat-line__username notranslate" role="button" tabindex="0"><span class="chat-author__display-name" style="color: ${color};">${display}</span></span><span>: </span><span class="message"><span class="text-fragment" data-a-target="chat-message-text">${text}</span></span></div></div>`
}

function sevenTvLine(line: ChatFixtureLine): string {
  const display = escapeHtml(line.display ?? line.login)
  const text = escapeHtml(line.text ?? 'That deserves a clip.')
  const color = line.color ?? 'rgb(30, 144, 255)'
  const badge = line.badge ? `<img class="seventv-chat-badge" alt="Prime" src="${BADGE_SRC}">` : ''
  const name = line.sevenTvPaint
    ? `<span class="seventv-painted-content" data-seventv-painted-text="true" style="background-image: linear-gradient(90deg, rgb(255, 0, 128), rgb(0, 200, 255));">${display}</span>`
    : `<span>${display}</span>`
  return `<div class="seventv-message"><div class="seventv-chat-message-background" tabindex="0"><div class="seventv-chat-message-container"><div class="seventv-chat-message-body"><div class="seventv-chat-user" style="color: ${color};"><span class="seventv-chat-user-badge-list">${badge}</span><span class="seventv-chat-user-username">${name}</span></div><span>: </span><span class="seventv-chat-message-body-text"><span class="text-token">${text}</span></span></div></div></div></div>`
}

export function chatLine(style: ChatFixtureStyle, line: ChatFixtureLine): string {
  if (style === 'ffz') return ffzLine(line)
  if (style === '7tv') return sevenTvLine(line)
  return nativeLine(line, style === 'bttv')
}

/** The message container each style puts lines into. */
export function chatContainer(style: ChatFixtureStyle, lines: string): string {
  if (style === '7tv') {
    return `<div class="chat-scrollable-area__message-container" data-test-selector="chat-scrollable-area__message-container" role="log" style="display:none"></div><main class="seventv-chat-list">${lines}</main>`
  }
  return `<div class="Layout-sc-1xcs6mc-0 dBRkEN chat-scrollable-area__message-container" data-test-selector="chat-scrollable-area__message-container" role="log">${lines}</div>`
}

/** Fixture people: a mix of listed Supporters and everyone else. */
export const FIXTURE_PEOPLE: ChatFixtureLine[] = [
  { login: 'crest_glass', display: 'Crest_Glass', id: '10000001', badge: true, text: 'that peak was wild' },
  { login: 'plainviewer', display: 'PlainViewer', id: '10000002', text: 'hello chat' },
  { login: 'crest_etched', display: 'crest_etched', id: '10000003', text: 'clip it' },
  { login: 'crest_halo', display: 'Crest_Halo', id: '10000004', badge: true, text: 'GG' },
  { login: 'another_one', display: 'Another_One', id: '10000005', badge: true, text: 'first time here' },
  { login: 'crest_new', display: 'Crest_New', id: '10000006', text: 'just subscribed to StreamPulse' },
]

/** [id, login, tier, paint, wave] for the listed fixture people. */
export const FIXTURE_LIST: Array<[string, string, number, number, number]> = [
  ['10000001', 'crest_glass', 3, 1, 0],
  ['10000003', 'crest_etched', 2, 2, 1],
  ['10000004', 'crest_halo', 4, 3, 3],
  ['10000006', 'crest_new', 0, 0, 0],
]

/** A full fake Twitch chat page at the given column width, for e2e. */
export function chatPage(style: ChatFixtureStyle, options: { width?: number; theme?: 'dark' | 'light'; lines?: string } = {}): string {
  const width = options.width ?? 340
  const theme = options.theme ?? 'dark'
  const lines = options.lines ?? FIXTURE_PEOPLE.map(person => chatLine(style, person)).join('')
  const bg = theme === 'dark' ? '#18181b' : '#ffffff'
  const fg = theme === 'dark' ? '#efeff1' : '#0e0e10'
  return `<!doctype html><html lang="en" class="tw-root--hover js-focus-visible tw-root--theme-${theme}"><head><meta charset="utf-8"><title>fixturechan - Chat - Twitch</title><style>
html,body{margin:0;background:${bg};color:${fg};font:13px/20px Inter,Roobert,"Helvetica Neue",Helvetica,Arial,sans-serif}
.chat-column{width:${width}px;height:100vh;overflow:hidden;border-right:1px solid #2f2f35;box-sizing:border-box}
.chat-scrollable-area__message-container,.seventv-chat-list{display:block;padding:10px 0}
.chat-line__message,.seventv-message{padding:5px 20px;word-wrap:break-word}
.chat-line__username-container,.chat-line__username,.chat-line__username>span{display:inline}
.chat-line__message-container>div,.chat-line__message-container>div>div,.chat-line__no-background,.chat-line__no-background>div{display:inline}
.chat-badge{display:inline-block;width:18px;height:18px;vertical-align:middle;margin:0 3px 2px 0}
.chat-badge-btn,button[data-a-target="chat-badge"]{background:none;border:0;padding:0;display:inline}
.InjectLayout-sc-1i43xsx-0{display:inline}
.chat-author__display-name{font-weight:700}
.chat-line__message--badges .ffz-badge{display:inline-block;width:18px;height:18px;vertical-align:middle;margin:0 3px 2px 0;background-size:contain}
.seventv-chat-message-background,.seventv-chat-message-container,.seventv-chat-message-body,.seventv-chat-user{display:inline}
.seventv-chat-badge{width:18px;height:18px;vertical-align:middle;margin:0 3px 2px 0}
.seventv-chat-user-username{font-weight:700}
.seventv-painted-content{-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
</style></head><body><div class="chat-column" data-chat-style="${style}">${chatContainer(style, lines)}</div></body></html>`
}
