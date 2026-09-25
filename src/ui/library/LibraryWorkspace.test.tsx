// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LibraryWorkspace } from './LibraryWorkspace.tsx'
import { createDemoRepository, createDemoSnapshot } from '../../../docs/pulse-extension/monetization-mockups/library-workflow/demoRepository.ts'
import type { LibraryRepository, LibrarySnapshot } from './model.ts'
import { demoContexts, demoPresentations } from '../../../docs/pulse-extension/monetization-mockups/library-workflow/demoContexts.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
// jsdom does not implement native modal behavior; browser verification covers focus/Escape.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value() { this.setAttribute('open', '') } },
  close: { configurable: true, value() { this.removeAttribute('open') } },
})
let root: Root | undefined
let container: HTMLDivElement
async function render(repository: LibraryRepository) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => { root!.render(<LibraryWorkspace repository={repository} onExport={() => {}} contexts={demoContexts} presentations={demoPresentations} />); await new Promise(r => setTimeout(r, 5)) })
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
    expect(card.textContent).toContain('Chat / min')
    expect(card.textContent).toContain('Emotes / min')
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
    expect(card.textContent).toContain('Replay link unavailable')
  })
  it('previews fixture analysis without recording history or fabricating footage', async () => {
    const repo = createDemoRepository('ready', 0)
    await render(repo)
    const before = await repo.load(new AbortController().signal)
    await click('Preview')
    expect(container.querySelector('dialog[open]')).toBeTruthy()
    expect(container.textContent).toContain('Illustrative analysis')
    expect(container.textContent).toContain('No verified frame is available')
    expect(container.querySelector('[role="tabpanel"] .pl-signal-bars')).toBeNull()
    expect(container.textContent).toContain('Halloween: The Game')
    expect(container.textContent).not.toContain('Video pending')
    await click('Analysis')
    expect(container.textContent).toContain('297')
    expect(container.textContent).toContain('No AI summary has been generated')
    await click('Clip workflow')
    const handoff = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Open in ReplayForge'))!
    expect(handoff.disabled).toBe(true)
    expect((await repo.load(new AbortController().signal)).moments).toEqual(before.moments)
  })
  it('keeps partial measurements unknown and allows bookmarking directly from history preview', async () => {
    const repo = createDemoRepository('ready', 0)
    await render(repo)
    await click('History'); await click('Preview'); await click('Analysis')
    expect(container.textContent).toContain('Partial coverage')
    expect(container.querySelector('dialog dd:last-child')?.textContent).toBeTruthy()
    expect(container.querySelector('dialog')?.textContent).toContain('7TV')
    expect(container.querySelector('dialog')?.textContent).toContain('30.0% of emote uses')
    await click('Bookmark')
    expect((await repo.load(new AbortController().signal)).moments.find(m => m.id === 'two')?.savedAt).toBeTypeOf('number')
    expect(container.querySelector('dialog')?.textContent).toContain('Bookmarked')
  })
  it('supports arrow-key navigation through preview tabs', async () => {
    await render(createDemoRepository('ready', 0)); await click('Preview')
    // Scoped to the dialog: the page itself now has a tab bar too.
    const dialog = container.querySelector('dialog[open]')!
    const first = dialog.querySelector('[role="tab"]')!
    await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Analysis')
    expect(document.activeElement?.textContent).toBe('Analysis')
  })
  it('has named regions and a real tab bar', async () => {
    await render(createDemoRepository('ready', 0))
    expect(container.querySelector('main[aria-label="My Moments settings"]')).toBeTruthy()
    expect(container.querySelector('input[type="search"]')?.id).toBeTruthy()
    const tabs = [...container.querySelectorAll('.pl-tabs [role="tab"]')]
    expect(tabs.map(t => t.textContent)).toEqual(['Bookmarks', 'History', 'Storage & privacy'])
    expect(tabs.filter(t => t.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    await click('History')
    expect(container.textContent).toContain('Automatic history is off')
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('History')
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
  it('shows retry on load failure', async () => {
    await render(createDemoRepository('load-error', 0))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not load')
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
    expect(container.textContent).toContain('No bookmarks yet')
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
    expect(container.textContent).toContain('Bookmarks need your Pulse account')
    expect(container.querySelector('a[href="#supporter"]')?.textContent).toBe('Connect account')

    await act(async () => root?.unmount())
    document.body.replaceChildren()
    await render(withState('expired'))
    expect(container.textContent).toContain('Your account link expired')
    expect(container.querySelector('a[href="#supporter"]')).toBeTruthy()

    await act(async () => root?.unmount())
    document.body.replaceChildren()
    await render(withState('error'))
    expect(container.textContent).toContain('Could not reach StreamPulse')
    // A transport failure is not something connecting an account will fix.
    expect(container.querySelector('a[href="#supporter"]')).toBeNull()

    await act(async () => root?.unmount())
    document.body.replaceChildren()
    await render(withState('ready'))
    expect(container.textContent).not.toContain('Bookmarks need your Pulse account')
    expect(container.textContent).not.toContain('Could not reach StreamPulse')
  })
  it('ignores stale completion after repository/account changes', async () => {
    let finish!: (snapshot: LibrarySnapshot) => void
    const old: LibraryRepository = { load: () => new Promise(resolve => { finish = resolve }), execute: async () => createDemoSnapshot(), export: async () => '' }
    await render(old)
    expect(container.textContent).toContain('Loading your moments')
    await act(async () => { root!.render(<LibraryWorkspace repository={createDemoRepository('new', 0)} onExport={() => {}} />) })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { finish(createDemoSnapshot()); await Promise.resolve() })
    expect(container.textContent).toContain('No bookmarks yet')
    expect(container.textContent).not.toContain('Halloween: The Game')
  })
})
