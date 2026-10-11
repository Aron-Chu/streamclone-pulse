import { describe, expect, it } from 'vitest'
import {
  extensionServiceWorkerTimeoutMessage,
  resolveExtensionBrowserLaunch,
} from './e2e/helpers/extensionBrowserLaunch'

describe('resolveExtensionBrowserLaunch', () => {
  it('uses the full chromium channel for headless runs with no channel set (headless shell cannot load MV3)', () => {
    expect(resolveExtensionBrowserLaunch(true, {})).toEqual({ channel: 'chromium', executablePath: undefined })
    expect(resolveExtensionBrowserLaunch(true, { PULSE_EXTENSION_BROWSER_CHANNEL: '  ' }))
      .toEqual({ channel: 'chromium', executablePath: undefined })
  })

  it('keeps the bundled default for headed runs (CI under xvfb)', () => {
    expect(resolveExtensionBrowserLaunch(false, {})).toEqual({ channel: undefined, executablePath: undefined })
  })

  it('honours an explicit channel in both modes', () => {
    expect(resolveExtensionBrowserLaunch(true, { PULSE_EXTENSION_BROWSER_CHANNEL: 'msedge' }).channel).toBe('msedge')
    expect(resolveExtensionBrowserLaunch(false, { PULSE_EXTENSION_BROWSER_CHANNEL: 'chrome' }).channel).toBe('chrome')
  })

  it('lets an executable path win over any channel', () => {
    expect(resolveExtensionBrowserLaunch(true, {
      PULSE_EXTENSION_BROWSER_CHANNEL: 'chrome',
      PULSE_EXTENSION_BROWSER_EXECUTABLE_PATH: ' /usr/bin/brave ',
    })).toEqual({ channel: undefined, executablePath: '/usr/bin/brave' })
  })
})

describe('extensionServiceWorkerTimeoutMessage', () => {
  it('names the browser and the headless-shell cause', () => {
    const message = extensionServiceWorkerTimeoutMessage(30_000, { channel: undefined, executablePath: undefined })
    expect(message).toContain('30000 ms')
    expect(message).toContain('default bundled browser')
    expect(message).toContain('PULSE_EXTENSION_BROWSER_CHANNEL=chromium')
  })
})
