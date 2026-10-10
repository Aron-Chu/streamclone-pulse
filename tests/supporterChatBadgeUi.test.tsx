// @vitest-environment jsdom
import SUPPORTER_PERKS from '../src/shared/supporter-perks.json'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_BADGE_CONSENT_COPY,
  CHAT_BADGE_COPY,
  SupporterChatBadgeControls,
} from '../src/options/SupporterChatBadgeControls.tsx'
import { SupporterPerkList } from '../src/options/SupporterPerkList.tsx'
import { SupporterWhoSees } from '../src/options/SupporterWhoSees.tsx'
import { CHAT_BADGE_CONSENT_VERSION, CHAT_CRESTS_KEY, CHAT_PAINT_MOTION_KEY } from '../src/shared/chatBadges.ts'
import type { ChatBadgeSnapshot } from '../src/shared/chatBadges.ts'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'
import { ChatCrestToggles } from '../src/ui/SettingsWorkspace.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Seen in chat, options side: the "In chat" card and its consent text, the
 * "Other StreamPulse viewers" row in Who sees what, the perk list's two
 * variants and the viewer settings. CHAT_BADGE_CONSENT_VERSION = 1 pins the
 * consent words below; changing them is a material change and bumps it.
 */

const unmounts: Array<() => void> = []
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount()
  vi.unstubAllGlobals()
})

async function mount(node: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  for (let k = 0; k < 4; k++) await act(async () => { await Promise.resolve() })
  unmounts.push(() => { act(() => root.unmount()); host.remove() })
  return host
}

function stubRuntime(reply: (message: Record<string, unknown>) => unknown, sync: Record<string, unknown> = {}) {
  const sendMessage = vi.fn(async (message: Record<string, unknown>) => reply(message))
  const set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(sync, items) })
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', sendMessage },
    storage: { sync: { get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.filter(key => key in sync).map(key => [key, sync[key]]))), set } },
  })
  return { sendMessage, set, sync }
}

function entitlement(chatBadge: ChatBadgeSnapshot | undefined, status: 'active' | 'grace' | 'expired' = 'active'): SupporterEntitlement {
  return {
    state: 'ready', status, supportPeriods: 7, features: ['supporter.banner.v1'], accessUntil: '2026-11-10T00:00:00Z',
    ...(chatBadge ? { chatBadge } : {}),
  } as SupporterEntitlement
}

const click = async (element: Element | null | undefined) => {
  await act(async () => { (element as HTMLElement).click() })
  for (let k = 0; k < 4; k++) await act(async () => { await Promise.resolve() })
}

describe('In chat card: consent text', () => {
  it('pins consent version 1 to the exact words the Supporter agrees to', () => {
    expect(CHAT_BADGE_CONSENT_VERSION).toBe(1)
    expect(CHAT_BADGE_CONSENT_COPY).toEqual({
      heading: 'Show your crest and paint in chat?',
      points: [
        'Other people who use the StreamPulse extension will see your crest beside your name in Twitch chat, and your name in your paint.',
        'To do this, StreamPulse publishes a public list with your Twitch username, your Twitch user ID, your crest level (it shows roughly how long you’ve supported) and your paint. Anyone can download this list.',
        'Twitch chat itself doesn’t change. People without StreamPulse see normal chat, and nothing is sent to Twitch.',
        'StreamPulse never learns which channels you or anyone else watches. Each extension downloads the whole list and adds crests on its own computer.',
        'You can turn it off any time. Your entry leaves the list within about an hour, and StreamPulse deletes the Twitch user ID and username it stored for this. It also leaves if your membership ends, you disconnect StreamPulse in your Twitch settings, or you delete your account.',
      ],
      confirmTwitch: 'You’ll confirm with Twitch that it’s your account.',
      accept: 'Continue with Twitch and turn on',
      decline: 'Not now',
      version: 1,
    })
    expect(CHAT_BADGE_COPY.switchLabel).toBe('Show my crest and paint to other StreamPulse viewers in chat')
  })
})

describe('In chat card: states', () => {
  it('is hidden without a server chatBadge (feature off) and for non-Supporters who never turned it on', async () => {
    stubRuntime(() => undefined)
    expect((await mount(<SupporterChatBadgeControls entitlement={entitlement(undefined)} />)).textContent).toBe('')
    expect((await mount(<SupporterChatBadgeControls entitlement={entitlement({ available: true, state: 'off' }, 'expired')} />)).textContent).toBe('')
    expect((await mount(<SupporterChatBadgeControls entitlement={null} />)).textContent).toBe('')
  })

  const cases: Array<[string, ChatBadgeSnapshot, 'active' | 'grace' | 'expired', string, boolean]> = [
    ['off', { available: true, state: 'off' }, 'active', 'Off. Only you see your crest and paint.', false],
    ['on', { available: true, state: 'on', login: 'crest_glass', consentVersion: 1 }, 'active', 'On. Other StreamPulse viewers see your crest and paint next to @crest_glass in chat.', true],
    ['grace', { available: true, state: 'on', login: 'crest_glass', consentVersion: 1 }, 'grace', 'On. Other StreamPulse viewers see your crest and paint next to @crest_glass in chat.', true],
    ['waiting', { available: true, state: 'waiting' }, 'active', 'On. Waiting for Twitch to confirm your username — your crest appears in chat once it does.', true],
    ['paused', { available: true, state: 'paused', login: 'crest_glass' }, 'expired', 'Paused while your membership is inactive. If you support again within 30 days it comes back on its own; after that, turn it on again.', true],
    ['no Twitch identity', { available: false, state: 'off' }, 'active', 'Seen in chat needs Continue with Twitch.', false],
    ['consent outdated', { available: true, state: 'on', login: 'crest_glass', consentVersion: 0 }, 'active', 'Turn on again to keep showing: what Seen in chat shares has been updated.', false],
  ]
  for (const [name, badge, status, helper, checked] of cases) {
    it(`${name}: says so plainly`, async () => {
      stubRuntime(() => undefined)
      const host = await mount(<SupporterChatBadgeControls entitlement={entitlement(badge, status)} />)
      expect(host.querySelector('h3')?.textContent).toBe('In chat')
      expect(host.querySelector('label')?.textContent).toBe('Show my crest and paint to other StreamPulse viewers in chat')
      expect(host.querySelector('[role="status"]')?.textContent).toBe(helper)
      const toggle = host.querySelector<HTMLInputElement>('input[role="switch"]')!
      expect(toggle.checked).toBe(checked)
      expect(toggle.disabled).toBe(!badge.available)
    })
  }
})

describe('In chat card: actions', () => {
  it('the switch opens the consent panel first; it flips only after the Twitch check and the server say on', async () => {
    const { sendMessage } = stubRuntime(message => message.action === 'on'
      ? { type: 'SUPPORTER_CHAT_BADGE', ok: true, listReceived: true, own: 'on', login: 'crest_glass' }
      : undefined)
    const host = await mount(<SupporterChatBadgeControls entitlement={entitlement({ available: true, state: 'off' })} />)
    const toggle = host.querySelector<HTMLInputElement>('input[role="switch"]')!
    await click(toggle)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(host.querySelector<HTMLInputElement>('input[role="switch"]')!.checked).toBe(false)
    const panel = host.querySelector<HTMLElement>('[data-chat-badge-consent]')!
    expect(panel.dataset.chatBadgeConsent).toBe('1')
    expect([...panel.querySelectorAll('li')].map(item => item.textContent)).toEqual(CHAT_BADGE_CONSENT_COPY.points)
    expect(panel.textContent).toContain('You’ll confirm with Twitch that it’s your account.')
    const accept = [...panel.querySelectorAll('button')].find(button => button.textContent?.includes('Continue with Twitch and turn on'))
    await click(accept)
    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([{ type: 'SUPPORTER_CHAT_BADGE', action: 'on' }])
    expect(host.querySelector('[data-chat-badge-consent]')).toBeNull()
    expect(host.querySelector<HTMLInputElement>('input[role="switch"]')!.checked).toBe(true)
    expect(host.querySelector('[role="status"]')?.textContent).toBe('On. Other StreamPulse viewers see your crest and paint next to @crest_glass in chat.')
    expect(host.textContent).toContain('Changes reach other viewers within about an hour.')
  })

  it('Not now changes nothing and sends nothing', async () => {
    const { sendMessage } = stubRuntime(() => undefined)
    const host = await mount(<SupporterChatBadgeControls entitlement={entitlement({ available: true, state: 'off' })} />)
    await click(host.querySelector('input[role="switch"]'))
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Not now'))
    expect(sendMessage).not.toHaveBeenCalled()
    expect(host.querySelector('[data-chat-badge-consent]')).toBeNull()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Nothing changed.')
  })

  const refusals: Array<[string, string]> = [
    ['identity_mismatch', 'That Twitch account isn’t the one signed in here. Use the same Twitch account.'],
    ['supporter_required', 'Seen in chat is for active Supporters.'],
    ['cancelled', 'Nothing changed.'],
    ['network', 'Couldn’t turn it on right now. Nothing changed. Try again in a moment.'],
    ['pilot_only', 'Couldn’t turn it on right now. Nothing changed. Try again in a moment.'],
  ]
  for (const [error, text] of refusals) {
    it(`a refused opt-in (${error}) leaves the switch off and says why`, async () => {
      stubRuntime(() => ({ type: 'SUPPORTER_CHAT_BADGE', ok: false, listReceived: false, error }))
      const host = await mount(<SupporterChatBadgeControls entitlement={entitlement({ available: true, state: 'off' })} />)
      await click(host.querySelector('input[role="switch"]'))
      await click([...host.querySelectorAll('button')].find(button => button.textContent?.includes('Continue with Twitch')))
      expect(host.querySelector<HTMLInputElement>('input[role="switch"]')!.checked).toBe(false)
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(text)
    })
  }

  it('Turn off is one click: no Twitch step, no confirmation', async () => {
    const { sendMessage } = stubRuntime(() => ({ type: 'SUPPORTER_CHAT_BADGE', ok: true, listReceived: true, own: 'off' }))
    const host = await mount(<SupporterChatBadgeControls entitlement={entitlement({ available: true, state: 'on', login: 'crest_glass', consentVersion: 1 })} />)
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Turn off'))
    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([{ type: 'SUPPORTER_CHAT_BADGE', action: 'off' }])
    expect(host.querySelector('[data-chat-badge-consent]')).toBeNull()
    expect(host.querySelector<HTMLInputElement>('input[role="switch"]')!.checked).toBe(false)
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Off. Your entry leaves the list within about an hour.')
  })
})

describe('Who sees what with Seen in chat', () => {
  const props = { finish: 'halo' as const, paint: { wave: 'ripple' as const, sheen: 'none' as const }, tenure: '6m' as const, rain: { mode: 'off', intensity: 35, title: '' } as never, shown: 'own' as const }

  it('before launch: two rows, nothing about other viewers', async () => {
    const host = await mount(<SupporterWhoSees {...props} />)
    expect([...host.querySelectorAll('.pulse-supporter-who > li strong')].map(node => node.textContent)).toEqual(['You', 'Everyone else on Twitch'])
    expect(host.textContent).not.toContain('Concept · not built')
  })

  it('live: three rows; the middle one says it shows only if you turn it on, or that it is on', async () => {
    for (const on of [false, true]) {
      const host = await mount(<SupporterWhoSees {...props} seenInChat={{ on }} />)
      const rows = [...host.querySelectorAll<HTMLElement>('.pulse-supporter-who > li')]
      expect(rows.map(row => row.querySelector('strong')?.textContent)).toEqual(['You', 'Other StreamPulse viewers', 'Everyone else on Twitch'])
      expect(rows[0].querySelector('.pulse-supporter-vis')?.textContent).toBe('Only you')
      expect(rows[1].querySelector('.pulse-supporter-vis')?.textContent).toBe(on ? 'Seen in chat · on' : 'Only if you turn it on')
      expect(rows[1].querySelector('small')?.textContent).toBe('Your crest beside your name and your paint on it, in Twitch chat')
      expect(rows[1].querySelector('.pulse-crest')?.getAttribute('data-tenure')).toBe('6m')
      expect(rows[1].querySelector<HTMLElement>('.pulse-paint')?.dataset).toMatchObject({ finish: 'halo', wave: 'ripple', sheen: 'none' })
      expect(rows[2].textContent).toContain('Normal chat. Nothing added.')
      expect(host.textContent).not.toContain('Concept · not built')
    }
  })
})

describe('Perk list with Seen in chat', () => {
  it('names only the four private perks until the feature is live, then adds Seen in chat and its own line', async () => {
    const before = await mount(<SupporterPerkList />)
    expect([...before.querySelectorAll('li')].map(item => item.getAttribute('data-perk-name'))).toEqual(SUPPORTER_PERKS.names)
    expect(before.textContent).toContain(SUPPORTER_PERKS.onlyYou)
    expect(before.textContent).not.toContain('Seen in chat')
    const live = await mount(<SupporterPerkList seenInChat />)
    expect([...live.querySelectorAll('li')].map(item => item.getAttribute('data-perk-name'))).toEqual([...SUPPORTER_PERKS.names, 'Seen in chat'])
    expect(live.querySelector('li[data-perk-name="Seen in chat"]')?.textContent).toBe(`Seen in chat: ${SUPPORTER_PERKS.seenInChat.detail}`)
    expect(live.textContent).toContain(SUPPORTER_PERKS.seenInChat.onlyYou)
    expect(live.textContent).not.toContain(SUPPORTER_PERKS.onlyYou)
  })
})

describe('Viewer settings: Show Supporter crests in chat', () => {
  it('stays hidden until this browser has received a list', async () => {
    stubRuntime(() => ({ type: 'SUPPORTER_CHAT_BADGE', ok: true, listReceived: false }))
    const host = await mount(<ChatCrestToggles />)
    expect(host.textContent).toBe('')
  })

  it('crests on by default, paint motion off by default; both save to storage.sync', async () => {
    const { set, sync } = stubRuntime(() => ({ type: 'SUPPORTER_CHAT_BADGE', ok: true, listReceived: true }))
    const host = await mount(<ChatCrestToggles />)
    const crests = host.querySelector<HTMLInputElement>('#settings-chat-crests')!
    const motion = host.querySelector<HTMLInputElement>('#settings-chat-paint-motion')!
    expect(host.textContent).toContain('Show Supporter crests in chat')
    expect(host.textContent).toContain('Other StreamPulse Supporters who chose to be seen get a crest beside their name, and their paint on it. Your extension downloads a public list about once an hour and never tells StreamPulse which chats you open.')
    expect(host.textContent).toContain('Animate paints in chat')
    expect(host.textContent).toContain('Off keeps every name still. Always still when your system asks for reduced motion.')
    expect(crests.checked).toBe(true)
    expect(motion.checked).toBe(false)
    await click(motion)
    expect(set).toHaveBeenLastCalledWith({ [CHAT_PAINT_MOTION_KEY]: true })
    await click(crests)
    expect(set).toHaveBeenLastCalledWith({ [CHAT_CRESTS_KEY]: false })
    expect(sync[CHAT_CRESTS_KEY]).toBe(false)
    // With crests off, motion has nothing to animate.
    expect(host.querySelector<HTMLInputElement>('#settings-chat-paint-motion')!.disabled).toBe(true)
  })
})
