// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LibraryWorkspace } from './LibraryWorkspace.tsx'
import { createDemoRepository, createDemoSnapshot } from '../../../docs/pulse-extension/monetization-mockups/library-workflow/demoRepository.ts'
import type { LibraryCommand, LibraryRepository, LibrarySnapshot } from './model.ts'
import { demoContexts, demoPresentations } from '../../../docs/pulse-extension/monetization-mockups/library-workflow/demoContexts.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
// jsdom does not implement native modal behavior; browser verification covers focus/Escape.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value() { this.setAttribute('open', '') } },
  close: { configurable: true, value() { this.removeAttribute('open') } },
})
let root: Root | undefined
let container: HTMLDivElement
async function render(repository: LibraryRepository, analyticsOrigin?: string) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => { root!.render(<LibraryWorkspace repository={repository} onExport={() => {}} contexts={demoContexts} presentations={demoPresentations} analyticsOrigin={analyticsOrigin} />); await new Promise(r => setTimeout(r, 5)) })
  await act(async () => { await new Promise(r => setTimeout(r, 5)) })
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent === text)
  if (!button) throw new Error(`Missing button ${text}`)
  await act(async () => { button.click(); await new Promise(r => setTimeout(r, 5)) })
}
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren() })
describe('My Moments frontend', () => {
  it('shows stats and 7TV on populated bookmark cards without opening a dialog', async () => {
    await render(createDemoRepository('design', 0))
    expect(container.querySelector('dialog')).toBeNull()
    const card = container.querySelector('.pl-moment')!
    expect(card.textContent).toContain('18,500')
    expect(card.textContent).toContain('Chat/min')
    expect(card.textContent).toContain('Emotes/min')
    expect(card.textContent).toContain('416')
    expect(card.textContent).toContain('520')
    expect(card.textContent).toContain('7TV')
    expect(card.querySelectorAll('.pl-emote-art img')).toHaveLength(3)
    expect(card.textContent).toContain('Example statistics')
  })
  it('does not turn an unverified replay reference into a playable link', async () => {
    await render(createDemoRepository('ready', 0))
    const card = [...container.querySelectorAll('.pl-moment')].find(item => item.textContent?.includes('Halloween: The Game'))!
    expect(card.querySelector('a[href*="/videos/"]')).toBeNull()
    expect(card.textContent).not.toContain('Replay link unavailable')
  })
  it('previews fixture analysis without recording history or fabricating footage', async () => {
    const repo = createDemoRepository('ready', 0)
    await render(repo)
    const before = await repo.load(new AbortController().signal)
    await click('Preview')
    const dialog = container.querySelector('dialog[open]')!
    expect(dialog.getAttribute('aria-label')).toBe('Moment preview')
    expect(dialog.textContent).toContain('Illustrative analysis')
    // No frame: Preview opens on the chart, with no picture block at all.
    expect(dialog.querySelector('.pl-around-frame, .pl-media')).toBeNull()
    expect(dialog.querySelector('.pl-around-chart svg')).toBeTruthy()
    expect(dialog.textContent).toContain('328')
    expect(dialog.textContent).toContain('297')
    expect(dialog.textContent).not.toContain('Video pending')
    // One screen: no tabs, no ReplayForge workflow. No VOD id, so no Clip; Analysis opens the session page.
    expect(dialog.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect(dialog.textContent).not.toContain('ReplayForge')
    expect([...dialog.querySelectorAll('button')].some(b => b.textContent?.includes('Clip'))).toBe(false)
    expect(dialog.querySelector<HTMLAnchorElement>('a[href^="http://127.0.0.1:5173/analytics/"]')?.textContent).toContain('Analysis')
    expect((await repo.load(new AbortController().signal)).moments).toEqual(before.moments)
  })
  it('keeps partial measurements unknown and allows bookmarking directly from history preview', async () => {
    const repo = createDemoRepository('ready', 0)
    await render(repo)
    await click('History'); await click('Preview')
    const dialog = () => container.querySelector('dialog[open]')!
    // Two of the seven sampled minutes are gaps: no bar, never a zero.
    expect(dialog().querySelectorAll('.pl-around-chart rect[data-minute]')).toHaveLength(5)
    expect(dialog().querySelector('.pl-around-tiles dd')?.textContent).toBe((18500).toLocaleString())
    expect(dialog().textContent).toContain('156 uses · 30%')
    const bookmark = dialog().querySelector<HTMLButtonElement>('button[aria-label^="Bookmark:"]')!
    expect(bookmark.classList.contains('pl-on')).toBe(false)
    await act(async () => { bookmark.click(); await new Promise(r => setTimeout(r, 5)) })
    expect((await repo.load(new AbortController().signal)).moments.find(m => m.id === 'two')?.savedAt).toBeTypeOf('number')
    expect(dialog().querySelector('button[aria-label^="Remove bookmark:"]')?.classList.contains('pl-on')).toBe(true)
  })
  it('removes the bookmark from Preview at once and Undo brings it back with its note', async () => {
    const repo = createDemoRepository('ready', 0)
    await render(repo)
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Preview: Halloween: The Game · emote reaction"]')!.click() })
    const dialog = () => container.querySelector('dialog[open]')
    await act(async () => { dialog()!.querySelector<HTMLButtonElement>('button[aria-label^="Remove bookmark:"]')!.click(); await new Promise(r => setTimeout(r, 5)) })
    // No confirm step: the bookmark is gone, Preview stays open on the moment and offers Undo.
    expect((await repo.load(new AbortController().signal)).moments.some(m => m.id === 'one')).toBe(false)
    expect(dialog()?.querySelector('[role="status"]')?.textContent).toBe('Bookmark removed.')
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Halloween: The Game · emote reaction')
    expect(dialog()?.querySelector('button[aria-label^="Bookmark:"]')).toBeTruthy()
    // J1: Remove hands focus to Undo.
    expect(document.activeElement?.textContent).toBe('Undo')
    await click('Undo')
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    // Undo, and the note it puts back after, end on the bookmark button, which stays focusable while busy.
    const mark = dialog()?.querySelector('button[aria-label^="Remove bookmark:"]')
    expect(document.activeElement).toBe(mark)
    expect(mark?.hasAttribute('disabled')).toBe(false)
    const back = (await repo.load(new AbortController().signal)).moments.find(m => m.id === 'one')
    expect(back?.savedAt).toBeTypeOf('number')
    expect(back?.note).toBe('Come back to this part of the Halloween stream.')
    expect(dialog()?.textContent).not.toContain('Bookmark removed.')
    expect(dialog()?.querySelector('button[aria-label^="Remove bookmark:"]')).toBeTruthy()
  })
  it('has named regions and a real tab bar', async () => {
    await render(createDemoRepository('ready', 0))
    expect(container.querySelector('main[aria-label="My Moments settings"]')).toBeTruthy()
    expect(container.querySelector('input[type="search"]')?.id).toBeTruthy()
    const tabs = [...container.querySelectorAll('.pl-tabs [role="tab"]')]
    expect(tabs.map(t => t.textContent)).toEqual(['Saved', 'History', 'Storage & privacy'])
    expect(tabs.filter(t => t.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    await click('History')
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('History')
  })
  it('moves between tabs with arrows, Home and End without the page scrolling too', async () => {
    await render(createDemoRepository('ready', 0))
    const selected = () => container.querySelector('.pl-tabs [role="tab"][aria-selected="true"]')?.textContent
    const press = async (key: string, modifiers: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
      await act(async () => { (document.activeElement ?? container).dispatchEvent(event); await new Promise(r => setTimeout(r, 5)) })
      return event.defaultPrevented
    }
    container.querySelector<HTMLElement>('.pl-tabs [role="tab"][aria-selected="true"]')!.focus()
    expect(await press('End')).toBe(true)
    expect(selected()).toBe('Storage & privacy')
    expect(await press('Home')).toBe(true)
    expect(selected()).toBe('Saved')
    expect(await press('ArrowRight')).toBe(true)
    expect(selected()).toBe('History')
    expect(document.activeElement?.textContent).toBe('History')
    expect(await press('ArrowLeft')).toBe(true)
    expect(selected()).toBe('Saved')
    // Keys the tab bar does not use, and browser shortcuts, keep their default.
    expect(await press('Tab')).toBe(false)
    expect(await press('ArrowDown')).toBe(false)
    expect(await press('ArrowLeft', { altKey: true })).toBe(false)
  })
  it('clears list filters when the account repository changes', async () => {
    const repository = createDemoRepository('ready', 0)
    await render(repository)
    const search = container.querySelector('input[type="search"]') as HTMLInputElement
    expect(search).toBeTruthy()
    await act(async () => {
      search.value = 'Halloween'
      search.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    expect((container.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('Halloween')
    await act(async () => {
      root!.render(<LibraryWorkspace repository={createDemoRepository('ready', 0)} onExport={() => {}} />)
    })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect((container.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('')
    expect(container.textContent).toContain('Halloween: The Game')
  })
  it('J1: Clear filters puts focus on the moments it brought back', async () => {
    await render(createDemoRepository('ready', 0))
    const search = container.querySelector('input[type="search"]') as HTMLInputElement
    // Through the native setter, so React sees the typing.
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'no such moment')
      search.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 5))
    })
    await click('Clear filters')
    expect(document.activeElement).toBe(container.querySelector('.pl-count[role="status"]'))
    expect(document.activeElement?.textContent).toMatch(/^\d+ moments?/)
  })
  it('MY-MOMENTS-5: a message from one tab does not follow you to the next', async () => {
    await render(createDemoRepository('ready', 0))
    await press(container.querySelector('button[aria-label="Remove: Halloween: The Game · emote reaction"]'))
    expect(status()).toBe('Removed from Saved.')
    await click('History')
    expect(status()).toBe('')
  })
  it('shows retry on load failure', async () => {
    await render(createDemoRepository('load-error', 0))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Simulated load failure')
    expect(container.textContent).toContain('Try loading again')
  })
  it('shows source failures and reaches storage settings', async () => {
    await render(createDemoRepository('ready', 0))
    expect(container.textContent).toContain('Source unavailable')
    await click('Storage & privacy')
    expect(container.textContent).toContain('Remember watched moments on this device')
    expect(container.textContent).toContain('Moment data allowance')
  })
  it('keeps empty and loading states truthful, without filters over an empty list', async () => {
    await render(createDemoRepository('new', 0))
    expect(container.textContent).toContain('No saves yet')
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    // Nothing to narrow: no search, no channel picker, and no count line beside
    // the empty state saying the same thing twice.
    expect(container.querySelector('input[type="search"]')).toBeNull()
    expect(container.textContent).not.toContain('0 moments')
  })
  it('names why bookmarks are missing and offers the action that fixes it', async () => {
    // A missing sign-in, an expired link and a dead network are three different
    // problems; one "could not be loaded" banner named none of them.
    const withState = (bookmarksState: string): LibraryRepository => {
      const snapshot = { ...createDemoSnapshot('new', 0), bookmarksState, bookmarksAvailable: bookmarksState === 'ready' }
      return { load: async () => snapshot as LibrarySnapshot, execute: async () => snapshot as LibrarySnapshot, export: async () => '' }
    }

    await render(withState('not_linked'))
    expect(container.textContent).toContain('Bookmarks are saved on this device')
    // Sign-in is compiled off: no account to promise or connect (a sign-in build
    // keeps Connect account; tests/myMomentsDeviceOnly.test.tsx covers both).
    expect(container.textContent).toContain('stay in this browser and are never uploaded')
    expect(container.querySelector('a[href="#supporter"]')).toBeNull()

    await act(async () => root?.unmount())
    document.body.replaceChildren()
    await render(withState('expired'))
    expect(container.textContent).toContain('Your account link expired')
    expect(container.textContent).not.toContain('No saves yet')
    expect(container.querySelector('a[href="#supporter"]')).toBeTruthy()

    await act(async () => root?.unmount())
    document.body.replaceChildren()
    await render(withState('error'))
    expect(container.textContent).toContain('Could not reach StreamPulse')
    // A failed read: no "change was confirmed" talk, and no empty state claiming
    // the account has no bookmarks when it could not be asked.
    expect(container.textContent).toContain('Your account bookmarks could not be loaded')
    expect(container.textContent).not.toContain('No saves yet')
    // A transport failure is not something connecting an account will fix.
    expect(container.querySelector('a[href="#supporter"]')).toBeNull()

    await act(async () => root?.unmount())
    document.body.replaceChildren()
    await render(withState('ready'))
    expect(container.textContent).not.toContain('Bookmarks are saved on this device')
    expect(container.textContent).not.toContain('Could not reach StreamPulse')
    expect(container.textContent).not.toContain('saved without an account')
  })
  it('lists pre-account device saves while an account is linked, with replay and analytics links and remove', async () => {
    const save = (id: string, extra: object) => ({ id, login: 'xqc', streamId: '123456', offsetSeconds: 754, label: '', notes: '', source: 'extension',
      createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z', ...extra })
    const deviceBookmarks = [
      save('local:a', { vodId: '1234567890', label: 'Chat spike', notes: 'kept here' }),
      save('local:b', { createdAt: '2026-10-02T12:00:00.000Z' }),
    ]
    const snapshot = { ...createDemoSnapshot('new', 0), bookmarksState: 'ready', bookmarksAvailable: true, deviceBookmarks }
    const commands: unknown[] = []
    const after = { ...snapshot, deviceBookmarks: deviceBookmarks.slice(1) }
    await render({ load: async () => snapshot as unknown as LibrarySnapshot,
      execute: async command => { commands.push(command); return after as unknown as LibrarySnapshot }, export: async () => '' }, 'http://localhost:5173')
    expect(container.textContent).toContain('2 bookmarks saved without an account are kept on this device, not in your account.')
    expect(container.textContent).toContain('No account saves yet')
    const rows = [...container.querySelectorAll<HTMLElement>('[data-device-save="true"]')]
    // Newest first; a stream-only save keeps the fallback title and no replay
    // link, but still opens its stream in Analytics on the configured portal,
    // as it did before the account linked.
    expect(rows.map(row => row.dataset.momentId)).toEqual(['local:b', 'local:a'])
    expect(rows[0].textContent).toContain('Saved moment')
    expect(rows[0].textContent).not.toContain('Replay link unavailable')
    expect(rows[0].querySelector('a[href*="/videos/"]')).toBeNull()
    const analyticsHref = (row: HTMLElement) => row.querySelector<HTMLAnchorElement>('a[aria-label^="Open analytics for"]')?.getAttribute('href')
    expect(analyticsHref(rows[0])).toBe('http://localhost:5173/analytics/xqc/123456#t=754')
    expect(analyticsHref(rows[1])).toBe('http://localhost:5173/analytics/xqc/123456#t=754')
    expect(rows[1].textContent).toContain('Chat spike')
    expect(rows[1].textContent).toContain('xqc · 0:12:34')
    expect(rows[1].textContent).toContain('kept here')
    expect(rows[1].querySelector('a')?.getAttribute('href')).toBe('https://www.twitch.tv/videos/1234567890?t=754s')
    // Read-only: no edit or preview, only remove.
    expect(rows[1].textContent).not.toContain('Edit note')
    expect(rows[1].textContent).not.toContain('Preview')
    await act(async () => { rows[1].querySelector<HTMLButtonElement>('button[aria-label="Remove from this device: Chat spike"]')!.click(); await new Promise(r => setTimeout(r, 5)) })
    expect(container.querySelector('dialog')?.textContent).toContain('from this device. Your account is not changed.')
    await click('Confirm change')
    expect(commands).toEqual([{ kind: 'unsave', id: 'local:a' }])
    expect(container.querySelectorAll('[data-device-save="true"]')).toHaveLength(1)
  })
  it('adds device saves to the account only after a confirm, one or all, and only while the account is reachable', async () => {
    const save = (id: string, label: string) => ({ id, login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds: 754, label, notes: '', source: 'extension',
      createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' })
    const deviceBookmarks = [save('local:a', 'Chat spike'), save('local:b', 'Clutch')]
    const commands: unknown[] = []
    const repository = (bookmarksState: string): LibraryRepository => {
      const snapshot = { ...createDemoSnapshot('new', 0), bookmarksState, bookmarksAvailable: bookmarksState === 'ready', deviceBookmarks }
      return { load: async () => snapshot as unknown as LibrarySnapshot,
        execute: async command => { commands.push(command); return { ...snapshot, deviceBookmarks: [] } as unknown as LibrarySnapshot }, export: async () => '' }
    }
    await render(repository('error'))
    // Device saves still list under the notice; the account side says nothing
    // rather than "No account saves yet".
    expect(container.querySelectorAll('[data-device-save="true"]')).toHaveLength(2)
    expect(container.textContent).not.toContain('No account saves yet')
    expect(container.querySelector('button[aria-label^="Add to your account"]')).toBeNull()
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Add all to account')).toBe(false)
    await act(async () => root?.unmount()); document.body.replaceChildren()

    await render(repository('ready'))
    expect(container.textContent).toContain('Add them to your account to keep them on every device where you sign in.')
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Add to your account: Clutch"]')!.click(); await new Promise(r => setTimeout(r, 5)) })
    const dialog = () => container.querySelector('dialog')?.textContent ?? ''
    expect(dialog()).toContain('Add to your account?')
    expect(dialog()).toContain('Notes stay on this device.')
    expect(commands).toEqual([])
    await click('Keep as is')
    expect(commands).toEqual([])
    await click('Add all to account')
    expect(dialog()).toContain('Add 2 bookmarks to your account?')
    const confirm = [...container.querySelectorAll('dialog button')].find(b => b.textContent === 'Add to account') as HTMLButtonElement
    await act(async () => { confirm.click(); await new Promise(r => setTimeout(r, 5)) })
    expect(commands).toEqual([{ kind: 'import-device-saves' }])
    expect(container.textContent).toContain('Added to your account.')
  })
  it('shows a change made elsewhere in place, and never undoes a change made on this page', async () => {
    let current = createDemoSnapshot('new', 0)
    let changed!: () => void
    let pending: ((snapshot: LibrarySnapshot) => void) | undefined
    const repository: LibraryRepository = {
      load: () => pending ? new Promise(resolve => { pending = resolve }) : Promise.resolve(structuredClone(current)),
      execute: async () => { current = { ...current, moments: current.moments.filter(m => m.id !== 'one') }; return structuredClone(current) },
      export: async () => '',
      subscribe: onChange => { changed = onChange; return () => undefined },
    }
    await render(repository)
    expect(container.textContent).toContain('No saves yet')
    current = createDemoSnapshot('ready', 0)
    await act(async () => { changed(); expect(container.textContent).not.toContain('Loading your moments'); await new Promise(r => setTimeout(r, 5)) })
    expect(container.textContent).toContain('Halloween: The Game')
    // A refresh that started before the page's own removal finishes after it.
    pending = () => undefined
    await act(async () => { changed(); await Promise.resolve() })
    const stale = pending!
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label^="Remove: Halloween"]')!.click(); await new Promise(r => setTimeout(r, 5)) })
    expect(container.textContent).not.toContain('Halloween: The Game')
    await act(async () => { stale(createDemoSnapshot('ready', 0)); await new Promise(r => setTimeout(r, 5)) })
    expect(container.textContent).not.toContain('Halloween: The Game')
  })
  it('ignores stale completion after repository/account changes', async () => {
    let finish!: (snapshot: LibrarySnapshot) => void
    const old: LibraryRepository = { load: () => new Promise(resolve => { finish = resolve }), execute: async () => createDemoSnapshot(), export: async () => '' }
    await render(old)
    expect(container.textContent).toContain('Loading your moments')
    await act(async () => { root!.render(<LibraryWorkspace repository={createDemoRepository('new', 0)} onExport={() => {}} />) })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { finish(createDemoSnapshot()); await Promise.resolve() })
    expect(container.textContent).toContain('No saves yet')
    expect(container.textContent).not.toContain('Halloween: The Game')
  })
})

/** A repository over one snapshot that records each command and applies it with `apply`. */
function recording(start: LibrarySnapshot, apply: (snapshot: LibrarySnapshot, command: LibraryCommand) => LibrarySnapshot = s => s) {
  let current = start
  const commands: LibraryCommand[] = []
  const repository: LibraryRepository = { load: async () => structuredClone(current),
    execute: async command => { commands.push(command); current = apply(current, command); return structuredClone(current) },
    export: async () => '' }
  return { repository, commands }
}
const row = (title: string) => [...container.querySelectorAll<HTMLElement>('.pl-moment')].find(item => item.textContent?.includes(title))!
const status = () => container.querySelector('.pl-feedback[role="status"]')?.textContent
async function press(element: Element | null) {
  if (!element) throw new Error('Missing element')
  await act(async () => { (element as HTMLElement).click(); await new Promise(r => setTimeout(r, 5)) })
}
describe('My Moments picks (H1–H4)', () => {
  it('H1: History has its own switch, the Storage setting, with an empty state for off and on', async () => {
    const { repository, commands } = recording(createDemoSnapshot('new'), (s, c) => c.kind === 'preferences' ? { ...s, preferences: c.value } : s)
    await render(repository)
    await click('History')
    const toggle = () => container.querySelector<HTMLButtonElement>('button[role="switch"]')!
    expect(toggle().getAttribute('aria-checked')).toBe('false')
    expect(container.textContent).toContain('Keeps the moments you watch, on this browser only.')
    expect(container.textContent).toContain('History is off')
    expect(container.textContent).toContain('Turn it on to find streams you watched again.')
    await press(toggle())
    expect(commands).toEqual([{ kind: 'preferences', value: { captureHistory: true, retentionDays: 90 } }])
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    expect(container.textContent).toContain('Nothing yet')
    expect(container.textContent).toContain('Jump to a moment and watch it for 10 seconds.')
    await click('Storage & privacy')
    const remember = [...container.querySelectorAll('label')].find(label => label.textContent?.includes('Remember watched moments on this device'))
    expect(remember?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true)
  })
  it('H1: keeps the "saved on this device" notice on Saved only', async () => {
    const snapshot = { ...createDemoSnapshot('new'), bookmarksState: 'not_linked', bookmarksAvailable: false } as LibrarySnapshot
    await render(recording(snapshot).repository)
    expect(container.textContent).toContain('Bookmarks are saved on this device')
    await click('History')
    expect(container.textContent).not.toContain('Bookmarks are saved on this device')
  })
  it('H2: each row shows a replay chip, and its main button follows the chip', async () => {
    await render(createDemoRepository('ready', 0))
    // Not linked yet (stream only): Preview is the main button.
    const notLinked = row('Halloween: The Game')
    expect(notLinked.dataset.replay).toBe('wait')
    expect(notLinked.querySelector('.pl-chip')?.textContent).toBe('Replay not linked yet')
    expect(notLinked.querySelector('.pl-actions > button[aria-label^="Preview:"]')).toBeTruthy()
    // May be gone: Open channel, with the old link kept under ⋯ to try.
    const gone = row('Reaction worth keeping')
    expect(gone.querySelector('.pl-chip')?.textContent).toBe('Replay may be gone')
    expect(gone.querySelector<HTMLAnchorElement>('.pl-actions > a[aria-label^="Open channel:"]')?.getAttribute('href')).toBe('https://www.twitch.tv/pixelharbor')
    expect(gone.querySelector('.pl-actions > a[aria-label^="Watch:"]')).toBeNull()
    const more = gone.querySelector('details.pl-moment-more')!
    expect(more.querySelector<HTMLAnchorElement>('a[aria-label^="Try the replay:"]')?.getAttribute('href')).toBe('https://www.twitch.tv/videos/9999999994?t=3370s')
    expect(more.textContent).toContain('Edit note')
    // Saved rows have no Save button; every row has ✕.
    expect(gone.querySelector('button[aria-label^="Save:"]')).toBeNull()
    expect(gone.querySelector('button[aria-label="Remove: Reaction worth keeping"]')?.textContent).toBe('✕')
    await click('History')
    // Ready: Watch is the main link; a History row not saved offers Save; a saved one says so.
    const ready = row('Chat spike after the reveal')
    expect(ready.querySelector('.pl-chip')?.textContent).toBe('Replay ready')
    expect(ready.querySelector<HTMLAnchorElement>('.pl-actions > a.pl-primary[aria-label^="Watch:"]')?.getAttribute('href')).toBe('https://www.twitch.tv/videos/9999999993?t=2284s')
    expect(ready.querySelector('button[aria-label="Save: Chat spike after the reveal"]')?.textContent).toBe('Save')
    expect(ready.querySelector('.pl-tag')).toBeNull()
    expect(row('Reaction worth keeping').querySelector('.pl-tag')?.textContent).toBe('Saved')
    expect(row('Reaction worth keeping').querySelector('button[aria-label^="Save:"]')).toBeNull()
  })
  it('H2: ✕ removes a save at once and Undo brings it back with its note', async () => {
    const repo = createDemoRepository('ready', 0)
    await render(repo)
    await press(container.querySelector('button[aria-label="Remove: Halloween: The Game · emote reaction"]'))
    expect(container.querySelector('dialog')).toBeNull()
    expect(status()).toBe('Removed from Saved.')
    expect(container.textContent).not.toContain('Halloween: The Game')
    // J1: the row is gone, so its Undo takes focus, not the page.
    expect(document.activeElement?.textContent).toBe('Undo')
    await click('Undo')
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    // Undo leaves too; the message saying what came back holds focus.
    expect(document.activeElement).toBe(container.querySelector('.pl-feedback'))
    const back = (await repo.load(new AbortController().signal)).moments.find(m => m.id === 'one')
    expect(back?.savedAt).toBeTypeOf('number')
    expect(back?.note).toBe('Come back to this part of the Halloween stream.')
    expect(row('Halloween: The Game')).toBeTruthy()
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Undo')).toBe(false)
  })
  it('H2: ✕ on History drops that visit and Undo puts it back at its time', async () => {
    const original = createDemoSnapshot('ready')
    const { repository, commands } = recording(original, (s, c) =>
      c.kind === 'remove-visit' ? { ...s, moments: s.moments.filter(m => m.id !== c.reference.id) }
        : c.kind === 'restore-visit' ? { ...s, moments: original.moments } : s)
    await render(repository)
    await click('History')
    const jumpedAt = original.moments.find(m => m.id === 'two')!.jumpedAt
    await press(container.querySelector('button[aria-label="Remove from History: Chat spike after the reveal"]'))
    expect(commands.map(c => c.kind)).toEqual(['remove-visit'])
    expect((commands[0] as { reference: { id: string } }).reference.id).toBe('two')
    expect(status()).toBe('Removed from History.')
    expect(container.textContent).not.toContain('Chat spike after the reveal')
    expect(document.activeElement?.textContent).toBe('Undo')
    await click('Undo')
    expect(commands[1]).toMatchObject({ kind: 'restore-visit', reference: { id: 'two' }, jumpedAt })
    expect(status()).toBe('Back in History.')
    expect(row('Chat spike after the reveal')).toBeTruthy()
  })
  it('H2: a synced History has no per-row ✕ (the account clears it as a whole)', async () => {
    const snapshot = { ...createDemoSnapshot('ready'), historySync: { state: 'on', syncedAt: null, pending: 0, failed: false } } as LibrarySnapshot
    await render(recording(snapshot).repository)
    await click('History')
    expect(row('Chat spike after the reveal')).toBeTruthy()
    expect(container.querySelector('button[aria-label^="Remove from History:"]')).toBeNull()
    expect(container.textContent).toContain('Keeps the moments you watch, synced to your account.')
  })
  describe('H4: Backup', () => {
    const now = Date.now()
    const exportFile = (moments: object[]) => JSON.stringify({ version: 1, exportedAt: new Date(now).toISOString(), moments })
    const saved = { id: 'a', channel: 'xqc', title: 'Clutch', vodId: '1234567890', offsetSeconds: 754, note: 'keep', availability: 'available', savedAt: now - 60_000 }
    const watched = { id: 'b', channel: 'lunaroom', title: 'Reveal', vodId: '1234567891', offsetSeconds: 90, note: '', availability: 'available', jumpedAt: now - 120_000 }
    async function pick(text: string, size = text.length) {
      const input = container.querySelector<HTMLInputElement>('input[type="file"][aria-label="Import a My Moments export"]')!
      Object.defineProperty(input, 'files', { configurable: true, value: [{ size, text: async () => text }] })
      await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 10)) })
    }
    it('offers Export, Import and Clear history with the import rule', async () => {
      await render(recording(createDemoSnapshot('new')).repository)
      await click('Storage & privacy')
      const card = [...container.querySelectorAll('section, .pl-stack > *')].find(el => el.textContent?.startsWith('Backup'))!
      expect(card.textContent).toContain('Save your moments and notes to a file, or load one from another browser.')
      expect([...card.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Export', 'Import', 'Clear history…'])
      expect(card.textContent).toContain('Import adds what’s new and skips moments you already have.')
      // Nothing watched: nothing to clear.
      expect([...card.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Clear history…')?.disabled).toBe(true)
    })
    it('rejects files that are not an export, too large or empty, without a change', async () => {
      const { repository, commands } = recording(createDemoSnapshot('new'))
      await render(repository)
      await click('Storage & privacy')
      await pick('not json')
      expect(status()).toBe('That file isn’t a My Moments export.')
      await pick(JSON.stringify({ version: 2, moments: [saved] }))
      expect(status()).toBe('That file isn’t a My Moments export.')
      await pick(exportFile([{ ...saved, channel: 'Not A Login!' }]))
      expect(status()).toBe('That export has no moments to add.')
      await pick('{}', 9 * 1048576)
      expect(status()).toBe('That file is too large to be a My Moments export.')
      expect(commands).toEqual([])
    })
    it('adds saves and watched moments, and says how many it skipped', async () => {
      const start = { ...createDemoSnapshot('new'), preferences: { captureHistory: true, retentionDays: 90 as const } }
      const { repository, commands } = recording(start, (s, c) => c.kind !== 'import-backup' ? s : { ...s, moments: [
        { ...saved, id: 'a' }, { ...watched, id: 'b', historyExpiresAt: now + 86_400_000 }] as LibrarySnapshot['moments'] })
      await render(repository)
      await click('Storage & privacy')
      await pick(exportFile([saved, watched]))
      expect(commands).toHaveLength(1)
      const command = commands[0] as Extract<LibraryCommand, { kind: 'import-backup' }>
      expect(command.saves).toEqual([{ channel: 'xqc', title: 'Clutch', vodId: '1234567890', offsetSeconds: 754, note: 'keep', at: saved.savedAt }])
      expect(command.history).toEqual([{ channel: 'lunaroom', title: 'Reveal', vodId: '1234567891', offsetSeconds: 90, note: '', at: watched.jumpedAt }])
      expect(status()).toBe('Added 2 moments.')
    })
    it('says when History is off and watched moments were left out', async () => {
      const { repository } = recording(createDemoSnapshot('new'), (s, c) => c.kind !== 'import-backup' ? s
        : { ...s, moments: [{ ...saved, id: 'a' }] as LibrarySnapshot['moments'] })
      await render(repository)
      await click('Storage & privacy')
      await pick(exportFile([{ ...saved, jumpedAt: now - 1000 }, saved]))
      expect(status()).toBe('Added 1 moment. Skipped 1 you already have. History is off, so watched moments were not added.')
    })
  })
})
