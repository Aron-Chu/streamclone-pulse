// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountFollows, FIRST_SIGN_IN_COPY, FirstSignInMove } from '../src/options/FirstSignInMove.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * After a Twitch sign-in, the options page asks once whether this browser's
 * saves (made while nobody was signed in) move to the account. Nothing moves
 * without an explicit yes; on a browser another Twitch account has used, the
 * safe answer, "Not mine", comes first and history is unticked.
 */
const SCOPE = 'https://api.streampulse.stream|account:one'
type Sent = { type: string; action?: string; scope?: string; command?: { kind: string; enabled?: boolean }; answer?: string }

function mount(props: Partial<Parameters<typeof FirstSignInMove>[0]> = {}, reply: (message: Sent) => unknown = () => ({ type: 'MY_MOMENTS', snapshot: {} })) {
  const sendMessage = vi.fn(async (message: Sent) => {
    const value = reply(message)
    if (value instanceof Error) throw value
    return value
  })
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
  const onDone = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(<>
    <FirstSignInMove scope={SCOPE} deviceSaves={12} deviceHistory={84} accountName="mira_tv" otherAccountSeen={false} onDone={onDone} {...props} />
  </>))
  const buttons = () => [...host.querySelectorAll('button')]
  return {
    host, sendMessage, onDone,
    text: () => host.textContent ?? '',
    heading: () => host.querySelector('h3')?.textContent,
    box: () => host.querySelector<HTMLInputElement>('input[type="checkbox"]'),
    buttons: () => buttons().map(button => button.textContent),
    primary: () => host.querySelector('.pulse-journey-primary')?.textContent,
    click: async (name: string) => { const target = buttons().find(button => button.textContent === name); if (!target) throw new Error(`no button ${name}`); await act(async () => target.click()) },
    sent: () => sendMessage.mock.calls.map(([message]) => message.action === 'mutate' ? `mutate:${message.command!.kind}${message.command!.enabled === undefined ? '' : `:${message.command!.enabled}`}` : `${message.action}${message.answer ? `:${message.answer}` : ''}`),
    cleanup: () => { act(() => root.unmount()); host.remove() },
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('first Twitch sign-in on this browser', () => {
  it('asks once to move this browser’s saves, history ticked, Move first', () => {
    const view = mount()
    try {
      expect(view.text()).toContain('Signed in with Twitch as mira_tv')
      expect(view.heading()).toBe('Move this browser’s 12 saves to your account?')
      expect(view.text()).toContain('They’ll follow you to every browser where you sign in. Notes stay on this browser.')
      expect(view.box()?.checked).toBe(true)
      expect(view.text()).toContain('Also sync watched history (84 moments)')
      expect(view.text()).toContain('Up to 1,000 recent moments. You can turn this off in My Moments.')
      expect(view.buttons()).toEqual(['Move 12 saves', 'Not now'])
      expect(view.primary()).toBe('Move 12 saves')
    } finally { view.cleanup() }
  })

  it('does not import device saves without an explicit yes', async () => {
    const view = mount()
    try {
      expect(view.sendMessage).not.toHaveBeenCalled()
      await view.click('Not now')
      expect(view.sent()).toEqual(['first-sign-in:later'])
      expect(view.onDone).toHaveBeenCalledWith(FIRST_SIGN_IN_COPY.stay)
    } finally { view.cleanup() }
  })

  it('Move runs import-device-saves, then history-sync when the box is ticked', async () => {
    const view = mount()
    try {
      await view.click('Move 12 saves')
      expect(view.sendMessage.mock.calls[0]![0]).toEqual({ type: 'MY_MOMENTS', action: 'mutate', scope: SCOPE, command: { kind: 'import-device-saves' } })
      expect(view.sent()).toEqual(['mutate:import-device-saves', 'mutate:history-sync:true', 'mutate:import-device-history', 'first-sign-in:move'])
      expect(view.onDone).toHaveBeenCalledWith('Moved 12 saves. History sync is on.')
    } finally { view.cleanup() }
  })

  it('Move with the box unticked moves only the saves', async () => {
    const view = mount()
    try {
      await act(async () => view.box()!.click())
      await view.click('Move 12 saves')
      expect(view.sent()).toEqual(['mutate:import-device-saves', 'first-sign-in:move'])
      expect(view.onDone).toHaveBeenCalledWith('Moved 12 saves.')
    } finally { view.cleanup() }
  })

  it('a failed move keeps the card, says why, and records nothing', async () => {
    const view = mount({}, message => message.action === 'mutate' ? new Error('Could not add to your account. Your saves stay on this device; try again shortly.') : {})
    try {
      await view.click('Move 12 saves')
      expect(view.host.querySelector('[role="alert"]')?.textContent).toBe('Could not add to your account. Your saves stay on this device; try again shortly.')
      expect(view.sent()).toEqual(['mutate:import-device-saves'])
      expect(view.onDone).not.toHaveBeenCalled()
      expect(view.buttons()).toContain('Move 12 saves')
    } finally { view.cleanup() }
  })

  it('a move whose history sync fails still records the answer and says sync stayed off', async () => {
    const view = mount({}, message => message.action === 'mutate' && message.command?.kind === 'history-sync' ? new Error('History sync is not available yet.') : { type: 'MY_MOMENTS', snapshot: {} })
    try {
      await view.click('Move 12 saves')
      expect(view.sent()).toEqual(['mutate:import-device-saves', 'mutate:history-sync:true', 'first-sign-in:move'])
      expect(view.onDone).toHaveBeenCalledWith('Moved 12 saves. History sync didn’t turn on. You can turn it on in My Moments.')
    } finally { view.cleanup() }
  })

  it('offers no history box when this browser has no history', () => {
    const view = mount({ deviceHistory: 0, deviceSaves: 1 })
    try {
      expect(view.box()).toBeNull()
      expect(view.heading()).toBe('Move this browser’s 1 save to your account?')
      expect(view.buttons()).toEqual(['Move 1 save', 'Not now'])
    } finally { view.cleanup() }
  })

  it('a different account on this browser is asked to add, with Not mine first and history unticked', () => {
    const view = mount({ accountName: 'kai_plays', otherAccountSeen: true })
    try {
      expect(view.heading()).toBe('Add these 12 saves to kai_plays?')
      expect(view.text()).toContain('They were saved on this browser while nobody was signed in. Another Twitch account has used this browser before, so they may not be yours.')
      expect(view.box()?.checked).toBe(false)
      expect(view.buttons()).toEqual(['Not mine', 'Add to kai_plays'])
      expect(view.primary()).toBe('Not mine')
    } finally { view.cleanup() }
  })

  it('Not mine imports nothing and records not-mine', async () => {
    const view = mount({ accountName: 'kai_plays', otherAccountSeen: true })
    try {
      await view.click('Not mine')
      expect(view.sent()).toEqual(['first-sign-in:not-mine'])
      expect(view.onDone).toHaveBeenCalledWith(FIRST_SIGN_IN_COPY.stay)
    } finally { view.cleanup() }
  })

  it('Add on a shared browser moves the saves, history only when ticked', async () => {
    const view = mount({ accountName: 'kai_plays', otherAccountSeen: true })
    try {
      await view.click('Add to kai_plays')
      expect(view.sent()).toEqual(['mutate:import-device-saves', 'first-sign-in:move'])
      expect(view.onDone).toHaveBeenCalledWith('Moved 12 saves.')
    } finally { view.cleanup() }
  })
})

describe('what follows the account', () => {
  function rows(props: Parameters<typeof AccountFollows>[0]) {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(<dl className="pulse-supporter-rows"><AccountFollows {...props} /></dl>))
    const row = (name: string) => host.querySelector(`[data-row="${name}"]`)
    return { host, row, cleanup: () => { act(() => root.unmount()); host.remove() } }
  }

  it('account card lists what follows the account', () => {
    const view = rows({ saves: 12, historySync: 'on', supporter: { line: 'Active · Renews on Dec 5' } })
    try {
      expect(view.row('saves')?.textContent).toBe('Saves12 · on every browser you sign in toOpen')
      expect(view.row('saves')?.querySelector('a')?.getAttribute('href')).toBe('#moments')
      expect(view.row('watched-history')?.textContent).toBe('Watched historySyncing · up to 1,000 momentsChange')
      expect(view.row('watched-history')?.querySelector('a')?.getAttribute('href')).toBe('#moments-history')
      expect(view.row('supporter')?.textContent).toBe('SupporterActive · Renews on Dec 5Details')
      expect(view.row('notes')?.textContent).toBe('NotesStay on this browser')
      expect([...view.host.querySelectorAll('[data-row]')].map(row => row.getAttribute('data-row'))).toEqual(['saves', 'watched-history', 'supporter', 'notes'])
    } finally { view.cleanup() }
  })

  it('says when history stays on this browser, and leaves out what this account does not have', () => {
    const view = rows({ saves: null, historySync: 'off', supporter: null })
    try {
      expect(view.row('saves')?.textContent).toBe('SavesOn every browser you sign in toOpen')
      expect(view.row('watched-history')?.textContent).toBe('Watched historyOff · this browser onlyChange')
      expect(view.row('supporter')).toBeNull()
    } finally { view.cleanup() }
    const unavailable = rows({ saves: 3, historySync: 'unavailable', supporter: null })
    try { expect(unavailable.row('watched-history')).toBeNull() } finally { unavailable.cleanup() }
  })
})
