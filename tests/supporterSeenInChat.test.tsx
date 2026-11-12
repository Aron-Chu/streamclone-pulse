// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHAT_BADGE_CONSENT_COPY, CHAT_BADGE_COPY, SupporterChatBadgeControls, type SeenInChatLink, type SeenInChatLook } from '../src/options/SupporterChatBadgeControls.tsx'
import { LINKED_COPY, SupporterLinkedRows } from '../src/options/SupporterLinkedRows.tsx'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'
import type { ChatBadgeSnapshot } from '../src/shared/chatBadges.ts'
import { DEFAULT_SUPPORTER_PAINT } from '../src/shared/supporterPaint.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LOOK: SeenInChatLook = { finish: 'halo', paint: DEFAULT_SUPPORTER_PAINT, tenure: '6m' }
const member = (chatBadge: ChatBadgeSnapshot, status = 'active'): SupporterEntitlement =>
  ({ state: 'ready', status, supportPeriods: 7, features: [], accountKind: 'installation', chatBadge }) as SupporterEntitlement

type Replies = Record<string, (message: { type: string; action?: string }) => unknown>

function stubWorker(replies: Replies = {}) {
  const sendMessage = vi.fn(async (message: { type: string; action?: string }) => {
    const reply = replies[`${message.type}:${message.action}`]
    if (reply) return reply(message)
    if (message.type === 'SUPPORTER_CHAT_BADGE' && message.action === 'status') return { type: 'SUPPORTER_CHAT_BADGE', ok: true, listReceived: true, keysPinned: true }
    return undefined
  })
  vi.stubGlobal('chrome', {
    runtime: { id: 'test', sendMessage },
    storage: { onChanged: { addListener: () => undefined, removeListener: () => undefined } },
  })
  return sendMessage
}

async function render(node: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  const button = (name: string) => [...host.querySelectorAll('button')].find(element => element.textContent === name)
  return {
    host,
    rerender: async (next: React.ReactNode) => { await act(async () => root.render(next)) },
    text: () => host.textContent ?? '',
    tag: () => host.querySelector('.pulse-supporter-tag')?.textContent,
    button,
    buttons: () => [...host.querySelectorAll('button')].map(element => element.textContent ?? ''),
    click: async (name: string) => { const target = button(name); if (!target) throw new Error(`no button ${name}`); await act(async () => target.click()) },
    cleanup: () => { act(() => root.unmount()); host.remove() },
  }
}

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); document.body.innerHTML = '' })

describe('Seen in chat card', () => {
  it('previews both chat lines, has no switch, and tags Off until the server says On', async () => {
    stubWorker()
    const view = await render(<SupporterChatBadgeControls entitlement={member({ available: true, state: 'off', login: 'my_login' })} look={LOOK} />)
    try {
      expect(view.host.querySelector('[role="switch"]')).toBeNull()
      expect(view.tag()).toBe('Public · Off')
      const preview = view.host.querySelector('[data-chat-badge-preview]')!
      expect(preview.textContent).toContain(`${CHAT_BADGE_COPY.wouldSee}my_login: hello chat`)
      expect(preview.textContent).toContain(`${CHAT_BADGE_COPY.everyoneElse}my_login: hello chat`)
      expect(preview.querySelector('.pulse-crest')?.getAttribute('aria-label')).toBe('StreamPulse Supporter, 6 months')
      // Chat draws paint and wave, never sheen.
      expect(preview.querySelector('.pulse-paint')?.getAttribute('data-sheen')).toBe('none')
      expect(view.text()).toContain(CHAT_BADGE_COPY.off)
      expect(view.buttons()).toEqual([CHAT_BADGE_COPY.review])
    } finally { view.cleanup() }
  })

  it('opens consent v2 below the preview, focuses its heading, and Not now returns focus', async () => {
    stubWorker()
    const view = await render(<SupporterChatBadgeControls entitlement={member({ available: true, state: 'off', login: 'my_login' })} look={LOOK} />)
    try {
      await view.click(CHAT_BADGE_COPY.review)
      const consent = view.host.querySelector('[data-chat-badge-consent]')!
      expect(consent.getAttribute('data-chat-badge-consent')).toBe('2')
      expect([...consent.querySelectorAll('li')].map(item => item.textContent)).toEqual([...CHAT_BADGE_CONSENT_COPY.points])
      expect(view.host.querySelector('[data-chat-badge-preview]')!.compareDocumentPosition(consent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(document.activeElement?.textContent).toBe(CHAT_BADGE_CONSENT_COPY.heading)
      await view.click(CHAT_BADGE_CONSENT_COPY.decline)
      expect(view.host.querySelector('[data-chat-badge-consent]')).toBeNull()
      expect(document.activeElement?.textContent).toBe(CHAT_BADGE_COPY.review)
      expect(view.host.querySelector('[role="alert"]')?.textContent).toBe(CHAT_BADGE_COPY.nothingChanged)
    } finally { view.cleanup() }
  })

  it('shows Pending after the server accepts, and On only when its next read says so', async () => {
    stubWorker({ 'SUPPORTER_CHAT_BADGE:on': () => ({ type: 'SUPPORTER_CHAT_BADGE', ok: true, listReceived: true, own: 'on', login: 'my_login' }) })
    const view = await render(<SupporterChatBadgeControls entitlement={member({ available: true, state: 'off', login: 'my_login' })} look={LOOK} />)
    try {
      await view.click(CHAT_BADGE_COPY.review)
      await view.click(CHAT_BADGE_CONSENT_COPY.accept)
      expect(view.tag()).toBe('Public · Pending')
      expect(view.text()).toContain(CHAT_BADGE_COPY.waiting)
      expect(document.activeElement?.getAttribute('role')).toBe('status')
      expect(view.buttons()).toEqual([CHAT_BADGE_COPY.turnOff])
      await view.rerender(<SupporterChatBadgeControls entitlement={member({ available: true, state: 'on', login: 'my_login' })} look={LOOK} />)
      expect(view.tag()).toBe('Public · On')
      expect(view.text()).toContain(CHAT_BADGE_COPY.on('my_login'))
      expect(view.text()).toContain(CHAT_BADGE_COPY.see)
      expect(view.text()).not.toContain(CHAT_BADGE_COPY.wouldSee)
    } finally { view.cleanup() }
  })

  it('keeps the tag On when turning off fails', async () => {
    stubWorker({ 'SUPPORTER_CHAT_BADGE:off': () => ({ type: 'SUPPORTER_CHAT_BADGE', ok: false, listReceived: true, error: 'network' }) })
    const view = await render(<SupporterChatBadgeControls entitlement={member({ available: true, state: 'on', login: 'my_login' })} look={LOOK} />)
    try {
      await view.click(CHAT_BADGE_COPY.turnOff)
      expect(view.tag()).toBe('Public · On')
      expect(view.host.querySelector('[role="alert"]')?.textContent).toBe('Couldn’t turn it off right now. Try again in a moment.')
    } finally { view.cleanup() }
  })

  it('asks a pay-first member to link Twitch first, from the membership card', async () => {
    stubWorker()
    const link: SeenInChatLink = { open: vi.fn() }
    const view = await render(<SupporterChatBadgeControls entitlement={member({ available: false, state: 'off' })} look={LOOK} link={link} />)
    try {
      expect(view.tag()).toBe('Public · Off')
      expect(view.text()).toContain(CHAT_BADGE_COPY.linkFirst)
      expect(view.host.querySelector('[data-chat-badge-preview]')?.textContent).toContain('you: hello chat')
      expect(view.buttons()).toEqual([CHAT_BADGE_COPY.linkTwitch])
      await view.click(CHAT_BADGE_COPY.linkTwitch)
      expect(link.open).toHaveBeenCalledOnce()
    } finally { view.cleanup() }
  })

  it('offers Review and turn on as soon as Twitch is linked here, before the next read; unlinking asks to link again', async () => {
    stubWorker()
    const linked = await render(<SupporterChatBadgeControls entitlement={member({ available: false, state: 'off' })} look={LOOK} link={{ open: null, linked: true, login: 'my_login' }} />)
    try {
      expect(linked.text()).not.toContain(CHAT_BADGE_COPY.needsTwitch)
      expect(linked.buttons()).toEqual([CHAT_BADGE_COPY.review])
      expect(linked.host.querySelector('[data-chat-badge-preview]')?.textContent).toContain('my_login: hello chat')
    } finally { linked.cleanup() }
    const unlinked = await render(<SupporterChatBadgeControls entitlement={member({ available: true, state: 'off', login: 'my_login' })} look={LOOK} link={{ open: vi.fn(), linked: false }} />)
    try {
      expect(unlinked.buttons()).toEqual([CHAT_BADGE_COPY.linkTwitch])
    } finally { unlinked.cleanup() }
  })

  it('without paint, both preview lines keep the plain Twitch name colour', async () => {
    stubWorker()
    const view = await render(<SupporterChatBadgeControls entitlement={member({ available: true, state: 'off', login: 'my_login' })} look={{ ...LOOK, finish: null }} />)
    try {
      const names = [...view.host.querySelectorAll('[data-chat-badge-preview] b')]
      expect(names.map(name => name.className)).toEqual(['pulse-chat-badge-plain-name', 'pulse-chat-badge-plain-name'])
    } finally { view.cleanup() }
  })

  it('keeps the existing words, with no action, where this browser cannot link', async () => {
    stubWorker()
    const view = await render(<SupporterChatBadgeControls entitlement={member({ available: false, state: 'off' })} look={LOOK} link={{ open: null }} />)
    try {
      expect(view.text()).toContain(CHAT_BADGE_COPY.needsTwitch)
      expect(view.buttons()).toEqual([])
    } finally { view.cleanup() }
  })

  it('offers renewing or withdrawing an outdated consent', async () => {
    stubWorker()
    const view = await render(<SupporterChatBadgeControls entitlement={member({ available: true, state: 'paused', login: 'my_login', consentVersion: 1 })} look={LOOK} />)
    try {
      expect(view.tag()).toBe('Public · Needs your OK')
      expect(view.text()).toContain(CHAT_BADGE_COPY.renew)
      expect(view.buttons()).toEqual([CHAT_BADGE_COPY.review, CHAT_BADGE_COPY.turnOff])
    } finally { view.cleanup() }
  })

  it('says Paused for an inactive membership and keeps Turn off', async () => {
    stubWorker()
    const view = await render(<SupporterChatBadgeControls entitlement={member({ available: true, state: 'paused', login: 'my_login', consentVersion: 2 }, 'expired')} look={LOOK} />)
    try {
      expect(view.tag()).toBe('Public · Paused')
      expect(view.text()).toContain(CHAT_BADGE_COPY.paused)
      expect(view.buttons()).toEqual([CHAT_BADGE_COPY.turnOff])
    } finally { view.cleanup() }
  })

  it('never reads a failed status check as Off: Unknown, with the last known state', async () => {
    stubWorker()
    const first = await render(<SupporterChatBadgeControls entitlement={member({ available: true, state: 'on', login: 'my_login' })} look={LOOK} />)
    first.cleanup()
    let finish = () => {}
    const checkAgain = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const view = await render(<SupporterChatBadgeControls entitlement={null} unavailable look={LOOK} link={{ open: null, checkAgain }} />)
    try {
      expect(view.tag()).toBe('Public · Unknown')
      expect(view.text()).toContain(`${CHAT_BADGE_COPY.unknown} ${CHAT_BADGE_COPY.lastKnownOn}`)
      expect(view.text()).not.toContain(CHAT_BADGE_COPY.off)
      await view.click(CHAT_BADGE_COPY.checkAgain)
      expect(checkAgain).toHaveBeenCalledOnce()
      expect(view.button(CHAT_BADGE_COPY.checking)?.disabled).toBe(true)
      await act(async () => finish())
      expect(view.button(CHAT_BADGE_COPY.checkAgain)?.disabled).toBe(false)
    } finally { view.cleanup() }
  })

  it('shows nothing while loading, and nothing for a failed check it never saw', async () => {
    stubWorker()
    const loading = await render(<SupporterChatBadgeControls entitlement={null} look={LOOK} />)
    try { expect(loading.host.innerHTML).toBe('') } finally { loading.cleanup() }
    const failed = await render(<SupporterChatBadgeControls entitlement={null} unavailable look={LOOK} />)
    try { expect(failed.host.innerHTML).toBe('') } finally { failed.cleanup() }
  })
})

describe('Linked to this membership', () => {
  const rows = (props: Partial<React.ComponentProps<typeof SupporterLinkedRows>> = {}) => <SupporterLinkedRows
    twitch={{ linked: false }} open={false} onOpen={() => undefined} onClose={() => undefined} onLinked={() => undefined} onUnlinked={() => undefined} {...props}
  />

  it('lists the Stripe email and an unlinked Twitch with Link Twitch', async () => {
    stubWorker()
    const view = await render(rows())
    try {
      expect(view.text()).toContain(`${LINKED_COPY.stripe}${LINKED_COPY.stripeValue}`)
      expect(view.text()).toContain(`${LINKED_COPY.twitch}${LINKED_COPY.notLinked}`)
      expect(view.buttons()).toEqual([LINKED_COPY.link])
    } finally { view.cleanup() }
  })

  it('opens the inline panel with its three points and moves focus to it', async () => {
    stubWorker()
    const view = await render(rows({ open: true }))
    try {
      const panel = view.host.querySelector('[data-twitch-link-panel]')!
      expect([...panel.querySelectorAll('li')].map(item => item.textContent)).toEqual([...LINKED_COPY.panelPoints])
      expect(panel.textContent).toContain(LINKED_COPY.confirmTwitch)
      expect(document.activeElement?.textContent).toBe(LINKED_COPY.panelHeading)
    } finally { view.cleanup() }
  })

  it('links, reports the login, and moves focus to the confirmation', async () => {
    const sendMessage = stubWorker({ 'SUPPORTER_TWITCH_LINK:link': () => ({ type: 'SUPPORTER_TWITCH_LINK', ok: true, login: 'my_login' }) })
    const onLinked = vi.fn()
    const onClose = vi.fn()
    const view = await render(rows({ open: true, onLinked, onClose }))
    try {
      await view.click(LINKED_COPY.continue)
      expect(sendMessage).toHaveBeenCalledWith({ type: 'SUPPORTER_TWITCH_LINK', action: 'link' })
      expect(onLinked).toHaveBeenCalledWith('my_login')
      expect(onClose).toHaveBeenCalledWith(false)
      await view.rerender(rows({ open: false, twitch: { linked: true, login: 'my_login' }, onLinked, onClose }))
      expect(view.host.querySelector('[role="status"]')?.textContent).toBe('Twitch linked as @my_login. Your membership didn’t change.')
      expect(view.text()).toContain('@my_login')
      expect(view.buttons()).toEqual([LINKED_COPY.unlink])
    } finally { view.cleanup() }
  })

  it.each([
    ['linked_elsewhere', LINKED_COPY.elsewhere],
    ['cancelled', LINKED_COPY.nothingChanged],
    ['network', LINKED_COPY.failed],
  ])('changes nothing and says so when linking fails: %s', async (error, words) => {
    stubWorker({ 'SUPPORTER_TWITCH_LINK:link': () => ({ type: 'SUPPORTER_TWITCH_LINK', ok: false, error }) })
    const onLinked = vi.fn()
    const view = await render(rows({ open: true, onLinked }))
    try {
      await view.click(LINKED_COPY.continue)
      expect(onLinked).not.toHaveBeenCalled()
      // Failures are alerts, as in the Seen in chat card; the polite region stays empty.
      const alert = view.host.querySelector('[data-twitch-link-alert]')!
      expect(alert.getAttribute('role')).toBe('alert')
      expect(alert.textContent).toContain(words)
      expect(!!alert.querySelector('a')).toBe(error === 'linked_elsewhere')
      expect(view.host.querySelector('[data-twitch-link-notice]')?.textContent).toBe('')
    } finally { view.cleanup() }
  })

  it('asks before unlinking, says Seen in chat turns off first, and Cancel changes nothing', async () => {
    const sendMessage = stubWorker()
    const view = await render(rows({ twitch: { linked: true } }))
    try {
      expect(view.text()).toContain(`${LINKED_COPY.twitch}${LINKED_COPY.linkedNoLogin}`)
      await view.click(LINKED_COPY.unlink)
      expect(view.text()).toContain(LINKED_COPY.unlinkBody)
      expect(document.activeElement?.textContent).toBe(LINKED_COPY.unlinkHeading)
      await view.click(LINKED_COPY.cancel)
      expect(document.activeElement?.textContent).toBe(LINKED_COPY.unlink)
      expect(sendMessage.mock.calls.filter(([message]) => message.type === 'SUPPORTER_TWITCH_LINK')).toHaveLength(0)
    } finally { view.cleanup() }
  })

  it('unlinks after the confirm', async () => {
    stubWorker({ 'SUPPORTER_TWITCH_LINK:unlink': () => ({ type: 'SUPPORTER_TWITCH_LINK', ok: true }) })
    const onUnlinked = vi.fn()
    const view = await render(rows({ twitch: { linked: true, login: 'my_login' }, onUnlinked }))
    try {
      await view.click(LINKED_COPY.unlink)
      const confirm = [...view.host.querySelectorAll<HTMLButtonElement>('[data-twitch-unlink-panel] button')].find(button => button.textContent === LINKED_COPY.unlinkConfirm)!
      await act(async () => confirm.click())
      expect(onUnlinked).toHaveBeenCalledOnce()
      expect(view.host.querySelector('[role="status"]')?.textContent).toBe(LINKED_COPY.unlinked)
    } finally { view.cleanup() }
  })
})
