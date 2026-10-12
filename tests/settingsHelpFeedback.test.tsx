// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NAV, SettingsHostShell } from '../src/options/SettingsHostShell.tsx'
import { injectHostStyles } from '../src/options/hostStyles.ts'
import { FEEDBACK_FORM_LIVE } from '../src/shared/feedbackPolicy.ts'
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
 * Feedback and Discord in the extension settings page: two website links in the
 * Community card on every section, never an invite. The website's /discord page
 * owns the invite, so it can rotate (or not exist yet) without a store release.
 * The Help & Feedback section that repeated them was removed on 2026-10-11. A
 * short subline under each link says what it is: "Public server" for Discord,
 * and a neutral line for feedback until the private form opens (D19,
 * FEEDBACK_FORM_LIVE; settingsCommunityFormLive.test.tsx covers the live state).
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

  it('have no Help & Feedback section: the nav ends on Updates & Changelog', () => {
    expect(DEFAULT_NAV.map(item => item.id)).toEqual(['moments', 'pulse', 'supporter', 'privacy', 'updates'])
    expect(DEFAULT_NAV.map(item => item.label)).not.toContain('Help & Feedback')
  })
})

type Rgb = [number, number, number]
const hex = (value: string): Rgb => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) as Rgb
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: Rgb, b: Rgb) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
/** Declarations of the settings-page rules whose selector list is exactly `selector` (narrow-layout overrides merged in). */
function hostRule(selector: string): Record<string, string> {
  injectHostStyles()
  const css = document.getElementById('streampulse-settings-host-styles')!.textContent!.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, head]) => head.trim() === selector)
  expect(rules.length, selector).toBeGreaterThan(0)
  return Object.assign({}, ...rules.map(rule => Object.fromEntries(rule[2].split(';').map(d => d.split(':').map(v => v.trim())).filter(([k, v]) => k && v))))
}

describe('settings page: Community card', () => {
  it('sends an old #help link to Updates & Changelog', async () => {
    const host = await mountAt('help')
    expect(host.querySelector('.pulse-host')?.getAttribute('data-host-active-section')).toBe('updates')
    expect(window.location.hash).toBe('#updates')
    expect(host.querySelector('[data-settings-section="updates"]')).not.toBeNull()
    expect(host.querySelector('[data-settings-section="help"]')).toBeNull()
    expect(host.querySelector('[data-settings-host-banner="supporter"]')).not.toBeNull()
  })

  it('shows the Community card under the section list on every section, with a subline that makes no privacy promise while the form is off', async () => {
    for (const section of ['moments', 'pulse', 'supporter', 'privacy', 'updates']) {
      const host = await mountAt(section)
      const card = host.querySelector('.pulse-host-rail > aside.pulse-host-community')
      expect(card?.getAttribute('aria-label')).toBe('Community')
      const discord = card?.querySelector('[data-community-link="discord"]')
      const feedback = card?.querySelector('[data-community-link="feedback"]')
      expectNewTabLink(discord, COMMUNITY_LINKS.discord)
      expectNewTabLink(feedback, COMMUNITY_LINKS.feedback)
      expect(FEEDBACK_FORM_LIVE).toBe(false)
      for (const [link, label, detail] of [[discord, 'Join the Discord', 'Public server'], [feedback, 'Send feedback', 'Ideas or problems']] as const) {
        // The label names the link; the visible subline is its description, not part of its name.
        expect(link!.querySelector('.pulse-host-community-copy > span')?.textContent).toBe(label)
        const small = link!.querySelector('.pulse-host-community-copy > small')!
        expect(small.textContent).toBe(detail)
        expect(small.getAttribute('aria-hidden')).toBe('true')
        expect(link!.getAttribute('aria-describedby')).toBe(small.id)
        expect(link!.querySelector('.pulse-host-community-sr')?.textContent).toBe(' (opens in a new tab)')
      }
      // /feedback lists only public places to ask until the form opens, so nothing here says private.
      expect(card?.textContent).not.toMatch(/private|only the team/i)
      // The card follows the nav, so keyboard order is still skip link, sections, content.
      const rail = host.querySelector('.pulse-host-rail')!
      expect(rail.firstElementChild?.matches('nav.pulse-host-nav')).toBe(true)
      // The Supporter banner shows everywhere except its own section.
      expect(host.querySelector('[data-settings-host-banner="supporter"]') !== null).toBe(section !== 'supporter')
      roots.splice(0).forEach(unmount => unmount())
    }
  })

  it('keeps each subline at 4.5:1 or better, at rest and hovered', () => {
    const link = hostRule('.pulse-host-community-link')
    const hover = hostRule('.pulse-host-community-link:hover')
    const discord = hostRule('.pulse-host-community-link[data-community-link="discord"]')
    const discordHover = hostRule('.pulse-host-community-link[data-community-link="discord"]:hover')
    const muted = hostRule('.pulse-host-community-copy small').color
    const onBlurple = hostRule('.pulse-host-community-link[data-community-link="discord"] .pulse-host-community-copy small').color
    expect(muted).toMatch(/^#[0-9a-f]{6}$/i)
    expect(onBlurple).toBe('#fff')
    for (const background of [link.background, hover.background]) expect(contrast(hex(muted), hex(background))).toBeGreaterThanOrEqual(4.5)
    for (const background of [discord.background, discordHover.background]) expect(contrast(hex('#ffffff'), hex(background))).toBeGreaterThanOrEqual(4.5)
  })

  it('has no Help link left on Updates & Changelog', async () => {
    const host = await mountAt('updates')
    expect(host.querySelector('a[href="#help"]')).toBeNull()
    expect(host.textContent).not.toContain('Get help or send feedback')
    expect(host.textContent).not.toContain('Help & Feedback')
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
