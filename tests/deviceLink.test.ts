import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkDeviceLinkBundles, deviceLinkShips } from '../scripts/lib/device-link-package.mjs'

/**
 * The invited-tester device link is compiled out of Firefox builds (D20) and
 * kept everywhere else. The package validator proves it on the built files of
 * every store target; these tests cover the switch, the worker and that check.
 */

async function loadForTarget(target: string) {
  vi.resetModules()
  vi.stubGlobal('__EXTENSION_TARGET__', target)
  const { DEVICE_LINK_ENABLED } = await import('../src/shared/deviceLink.ts')
  const { SupporterAccountCoordinator } = await import('../src/background/supporterAccount.ts')
  const { productLink } = await import('../src/shared/portalLinks.ts')
  return { DEVICE_LINK_ENABLED, SupporterAccountCoordinator, productLink }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('device link build switch', () => {
  it('is off for Firefox only', async () => {
    for (const target of ['development', 'cws', 'edge']) {
      expect((await loadForTarget(target)).DEVICE_LINK_ENABLED).toBe(true)
      expect(deviceLinkShips(target)).toBe(true)
    }
    expect((await loadForTarget('firefox')).DEVICE_LINK_ENABLED).toBe(false)
    expect(deviceLinkShips('firefox')).toBe(false)
  })

  it('leaves the link page out of Firefox builds', async () => {
    expect((await loadForTarget('cws')).productLink('linkDevice')).toBe('https://streampulse.stream/account/link-device')
    expect((await loadForTarget('firefox')).productLink('linkDevice')).not.toContain('link-device')
  })
})

describe('account worker without the device link', () => {
  const now = Date.parse('2026-10-11T12:00:00Z')
  const pending = { kind: 'pending', secret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: new Date(now + 600_000).toISOString(), nextPoll: now - 1 }

  async function worker(target: string, initial: unknown) {
    const { SupporterAccountCoordinator } = await loadForTarget(target)
    let stored = initial
    const request = vi.fn(async (path: string) => {
      if (path === '/v1/account/device-links') return { status: 201, body: { pollingSecret: 'd'.repeat(64), code: 'ABCDE-12345', expiresAt: new Date(now + 600_000).toISOString() } }
      return { status: 200, body: { state: 'pending' } }
    })
    const coordinator = new SupporterAccountCoordinator({ read: async () => stored, write: async next => { stored = next }, request, now: () => now })
    return { coordinator, request }
  }

  it('never requests a link code or polls one on Firefox', async () => {
    const start = await worker('firefox', null)
    expect(await start.coordinator.run('start')).toEqual({ state: 'signed_out' })
    const poll = await worker('firefox', pending)
    expect(await poll.coordinator.run('poll')).toEqual({ state: 'signed_out' })
    expect(start.request).not.toHaveBeenCalled()
    expect(poll.request).not.toHaveBeenCalled()
  })

  it('keeps both requests on Chrome', async () => {
    const start = await worker('cws', null)
    expect(await start.coordinator.run('start')).toMatchObject({ state: 'pending', code: 'ABCDE-12345' })
    expect(start.request).toHaveBeenCalledWith('/v1/account/device-links', { label: 'StreamPulse extension' })
    const poll = await worker('cws', pending)
    expect(await poll.coordinator.run('poll')).toMatchObject({ state: 'pending' })
    expect(poll.request).toHaveBeenCalledWith('/v1/account/device-links/poll', { pollingSecret: pending.secret })
  })
})

describe('device link package check', () => {
  const chrome = {
    'background/service-worker.js': 'request(`/v1/account/device-links`);request(`/v1/account/device-links/poll`)',
    'options/options.js': 'link:`/account/link-device`',
  }

  it('fails a Firefox package that still holds any part of the link', () => {
    expect(checkDeviceLinkBundles('firefox', { 'options/options.js': 'ok' }).errors).toEqual([])
    expect(checkDeviceLinkBundles('firefox', chrome).errors).toEqual([
      'firefox build must not contain the device link: "/v1/account/device-links" in background/service-worker.js',
      'firefox build must not contain the device link: "/account/link-device" in options/options.js',
    ])
    for (const label of ['Connect this extension', 'Connect tester account', 'Invited tester? Connect a tester account']) {
      const button = checkDeviceLinkBundles('firefox', { 'options/options.js': `children:${label}` })
      expect(button.errors).toEqual([`firefox build must not contain the device link: "${label}" in options/options.js`])
    }
  })

  it('fails a Chrome, Edge or development package that lost the link', () => {
    for (const target of ['cws', 'edge', 'development']) {
      expect(checkDeviceLinkBundles(target, chrome).errors).toEqual([])
      expect(checkDeviceLinkBundles(target, { 'options/options.js': 'link:`/account/link-device`' }).errors)
        .toEqual([`${target} build lost the device link: no bundle contains "/v1/account/device-links"`])
    }
  })

  it('runs on every package the validator checks', () => {
    const validator = readFileSync(new URL('../scripts/validate-extension-package.mjs', import.meta.url), 'utf8')
    expect(validator).toContain('checkDeviceLinkBundles(target, bundles)')
  })
})
