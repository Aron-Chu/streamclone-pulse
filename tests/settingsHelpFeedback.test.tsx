// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NAV, SettingsHostShell } from '../src/options/SettingsHostShell.tsx'
import { COMMUNITY_LINKS } from '../src/shared/portalLinks.ts'
import { SettingsWorkspace } from '../src/ui/SettingsWorkspace.tsx'
import { resetSupporterAppearanceForTests } from '../src/ui/useSupporterAppearance.ts'
import { listSourceFiles } from './helpers/sourceFiles.ts'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async ({ type }: { type: string }) => {
    if (type === 'HEALTH') return { type: 'HEALTH', ok: true }
    if (type === 'GET_UPDATE_CHECK_CAPABILITY') return { type: 'UPDATE_CHECK_CAPABILITY', supported: false, managedBy: 'development' }
    return { ok: true }
  }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Help & Feedback in the extension settings page: two website links, never an
 * invite. The website's /discord page owns the invite, so it can rotate (or not
 * exist yet) without a store release.
 */
const roots: Array<() => void> = []

async function mountAt(hash: string) {
  window.history.replaceState(null, '', `/options/index.html#${hash}`)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(
    <SettingsHostShell>
      {(section, perks) => <SettingsWorkspace activeSection={section} supporterPerks={perks} />}
    </SettingsHostShell>,
  ))
  for (let k = 0; k < 4; k++) await act(async () => { await Promise.resolve() })
  roots.push(() => { act(() => root.unmount()); host.remove() })
  return host
}

function expectNewTabLink(link: Element | null | undefined, href: string) {
  expect(link, `link to ${href}`).toBeTruthy()
  expect(link!.getAttribute('href')).toBe(href)
  expect(link!.getAttribute('target')).toBe('_blank')
  expect(link!.getAttribute('rel')).toBe('noopener noreferrer')
}

beforeEach(() => {
  resetSupporterAppearanceForTests()
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => path,
      getManifest: () => ({ version: '0.2.1' }),
      sendMessage: vi.fn(async (message: { type: string }) => message.type === 'SUPPORTER_APPEARANCE'
        ? { type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 0 }
        : undefined),
    },
    storage: {
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      session: { get: vi.fn(async () => ({})), remove: vi.fn(async () => {}) },
      onChanged: { addListener() {}, removeListener() {} },
    },
  })
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})

afterEach(() => {
  for (const unmount of roots.splice(0)) unmount()
  vi.unstubAllGlobals()
  delete (window as { matchMedia?: unknown }).matchMedia
  document.body.replaceChildren()
})

describe('community links', () => {
  it('point at the website pages only, never at an invite', () => {
    expect(COMMUNITY_LINKS).toEqual({
      feedback: 'https://streampulse.stream/feedback',
      discord: 'https://streampulse.stream/discord',
    })
  })

  it('list Help & Feedback after Updates in the section nav', () => {
    expect(DEFAULT_NAV.map(item => item.id)).toEqual(['moments', 'pulse', 'supporter', 'privacy', 'updates', 'help'])
    expect(DEFAULT_NAV.at(-1)).toEqual({ id: 'help', label: 'Help & Feedback' })
  })
})

describe('settings page: Help & Feedback', () => {
  it('offers the Discord page and the feedback form as two new-tab choices, without the Supporter banner', async () => {
    const host = await mountAt('help')
    expect(host.querySelector('.pulse-host')?.getAttribute('data-host-active-section')).toBe('help')
    expect(host.querySelector('[data-settings-section="help"] h2')?.textContent).toBe('Help & Feedback')
    const choices = [...host.querySelectorAll('[data-help-choice]')]
    expect(choices.map(choice => choice.getAttribute('data-help-choice'))).toEqual(['discord', 'feedback'])
    expectNewTabLink(choices[0], COMMUNITY_LINKS.discord)
    expectNewTabLink(choices[1], COMMUNITY_LINKS.feedback)
    // Named by the title; the one-line detail is the description.
    const title = (choice: Element) => document.getElementById(choice.getAttribute('aria-labelledby')!)?.textContent
    const detail = (choice: Element) => document.getElementById(choice.getAttribute('aria-describedby')!)?.textContent
    expect(title(choices[0])).toBe('Join the StreamPulse Discord (opens in a new tab)')
    // Discord is public; only the feedback form is described as private.
    expect(detail(choices[0])).toBe('Public server: ideas, help and release news')
    expect(title(choices[1])).toBe('Send feedback (opens in a new tab)')
    expect(detail(choices[1])).toBe('Private. Only the team reads it.')
    expect(host.querySelector('[data-settings-host-banner="supporter"]')).toBeNull()
    // The Community card stays put here too; only the Supporter banner steps aside.
    expect(host.querySelector('.pulse-host-rail > aside.pulse-host-community')).not.toBeNull()
  })

  it('shows the Community card under the section list on every section', async () => {
    for (const section of ['moments', 'pulse', 'supporter', 'privacy', 'updates', 'help']) {
      const host = await mountAt(section)
      const card = host.querySelector('.pulse-host-rail > aside.pulse-host-community')
      expect(card?.getAttribute('aria-label')).toBe('Community')
      expectNewTabLink(card?.querySelector('[data-community-link="discord"]'), COMMUNITY_LINKS.discord)
      expectNewTabLink(card?.querySelector('[data-community-link="feedback"]'), COMMUNITY_LINKS.feedback)
      expect(card?.querySelector('[data-community-link="discord"]')?.textContent).toBe('Join the Discord (opens in a new tab)')
      expect(card?.querySelector('[data-community-link="feedback"]')?.textContent).toBe('Send feedback (opens in a new tab)')
      // The card follows the nav, so keyboard order is still skip link, sections, content.
      const rail = host.querySelector('.pulse-host-rail')!
      expect(rail.firstElementChild?.matches('nav.pulse-host-nav')).toBe(true)
      // The Supporter banner shows everywhere except its own section and Help & Feedback.
      expect(host.querySelector('[data-settings-host-banner="supporter"]') !== null).toBe(section !== 'supporter' && section !== 'help')
      roots.splice(0).forEach(unmount => unmount())
    }
  })

  it('sends Updates readers to the Help section instead of an external support page', async () => {
    const host = await mountAt('updates')
    const link = [...host.querySelectorAll('[data-settings-section="updates"] a')].find(anchor => anchor.textContent === 'Get help or send feedback →')
    expect(link?.getAttribute('href')).toBe('#help')
    expect(link?.hasAttribute('target')).toBe(false)
    expect(host.textContent).not.toContain('Open StreamPulse support')
  })
})

describe('no Discord invite in the extension', () => {
  it('keeps every discord.gg and discord.com/invite literal out of the packaged sources', () => {
    const extensions = ['.ts', '.tsx', '.js', '.mjs', '.css', '.html', '.json']
    const files = ['src', 'popup', 'options', 'public', 'manifests'].flatMap(root => listSourceFiles(root, extensions)).concat('manifest.json')
    expect(files.filter(file => file.startsWith('src/')).length).toBeGreaterThan(50)
    const offenders = files.filter(file => /discord(?:app)?\.(?:gg|com\/invite)\//i.test(readFileSync(file, 'utf8')))
    expect(offenders, 'the extension links to streampulse.stream/discord; the website owns the invite').toEqual([])
  })
})
