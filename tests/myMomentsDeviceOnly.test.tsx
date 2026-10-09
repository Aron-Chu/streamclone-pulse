// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { DEVICE_ONLY_COPY, DEVICE_ONLY_INTRO, LibraryWorkspace } from '../src/ui/library/LibraryWorkspace.tsx'
import type { LibraryRepository } from '../src/ui/library/model.ts'
import type { MyMomentsSnapshot } from '../src/shared/myMoments.ts'
import type { BookmarksState } from '../src/shared/myMoments.ts'
import { TWITCH_SIGNIN_ENABLED } from '../src/shared/twitchSignIn.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Release review 2026-10-09 (A-3): with Sign in with Twitch compiled off,
 * nobody can create a Pulse account, so My Moments never promises one and
 * never offers a button that loops to "sign-ups are not open". Builds with
 * sign-in on keep their account copy unchanged.
 */
function snapshot(bookmarksState: BookmarksState): MyMomentsSnapshot {
  return {
    scope: 'test|device', production: true, bookmarksState, bookmarksAvailable: bookmarksState === 'ready', localNotes: {}, deviceBookmarks: [],
    moments: [], collections: [], preferences: { captureHistory: true, retentionDays: 30 }, membership: 'free',
    storage: { usedBytes: 0, limitBytes: 25 * 1048576, persistence: 'unknown' }, sync: { kind: 'local' },
  }
}

afterEach(() => { document.body.replaceChildren() })

async function render(state: BookmarksState, accountsOpen?: boolean) {
  const repository: LibraryRepository = {
    load: async () => snapshot(state),
    execute: async () => snapshot(state),
    export: async () => '{}',
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(LibraryWorkspace, { repository, onExport: () => {}, ...(accountsOpen === undefined ? {} : { accountsOpen }) })))
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  return { host, text: () => host.textContent ?? '', buttons: () => [...host.querySelectorAll('button, a.pl-button')].map(element => element.textContent), cleanup: () => act(() => root.unmount()) }
}

describe('My Moments with sign-in compiled off', () => {
  it('is what every store build ships today', () => {
    expect(TWITCH_SIGNIN_ENABLED).toBe(false)
  })

  it('says saves stay in this browser and accounts are coming, with no account button and no Retry', async () => {
    const view = await render('not_linked')
    try {
      expect(view.text()).toContain('Bookmarks are saved on this device')
      expect(view.text()).toContain(DEVICE_ONLY_COPY)
      expect(view.text()).toContain(DEVICE_ONLY_INTRO)
      expect(DEVICE_ONLY_COPY).toContain('Accounts are coming with Continue with Twitch')
      expect(view.text()).not.toMatch(/free Pulse account|Connect account|follow you to any device/)
      expect(view.buttons()).not.toContain('Connect account')
      expect(view.buttons()).not.toContain('Retry')
      expect(view.host.querySelector('a[href="#supporter"]')).toBeNull()
    } finally { view.cleanup() }
  })

  it.each<BookmarksState>(['ready', 'error', 'expired'])('never promises a free account in the %s state', async state => {
    const view = await render(state)
    try {
      expect(view.text()).toContain(DEVICE_ONLY_INTRO)
      expect(view.text()).not.toMatch(/free Pulse account/)
    } finally { view.cleanup() }
  })

  it('keeps Retry only where a retry can change something: the unreachable state', async () => {
    const view = await render('error')
    try {
      expect(view.text()).toContain('Could not reach StreamPulse')
      expect(view.buttons()).toContain('Retry')
      expect(view.buttons()).not.toContain('Connect account')
    } finally { view.cleanup() }
  })
})

describe('My Moments with sign-in on (tester and public builds)', () => {
  it('keeps its account copy and Connect account unchanged', async () => {
    const view = await render('not_linked', true)
    try {
      expect(view.text()).toContain('Connect a free Pulse account and new bookmarks follow you to any device.')
      expect(view.text()).not.toContain(DEVICE_ONLY_INTRO)
      expect(view.buttons()).toEqual(expect.arrayContaining(['Connect account', 'Retry']))
    } finally { view.cleanup() }
  })
})
