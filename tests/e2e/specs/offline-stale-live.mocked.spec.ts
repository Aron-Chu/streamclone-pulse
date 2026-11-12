import { readFileSync } from 'node:fs'
import { test, expect } from '../helpers/testFixtures.ts'
import { PULSE_ROOT_ID, assertNoUncaughtErrors, pulseShadowText, waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

// Real-Twitch check, 2026-10-19: the backend kept an ended stream open as live but no
// longer collected it. On the offline channel the panel read "Not tracked".
test('an open stream the backend no longer collects reads Offline on an offline channel', async ({
  extension, prepare, evidence,
}) => {
  await prepare({ scenario: 'offline', twitchKind: 'offline' })
  const fixture = JSON.parse(readFileSync(
    new URL('../fixtures/api/pulse-offline.json', import.meta.url), 'utf8',
  ))
  const payload = { ...fixture, isLive: true, tracking: false, endedAt: null, recap: null }
  await extension.context.route(
    'https://api.streampulse.stream/v1/extension/pulse/channels/fixturechan*',
    async route => {
      if (new URL(route.request().url()).pathname.endsWith('/fixturechan')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
      } else {
        await route.fallback()
      }
    },
  )
  await openTwitchChannel(extension.page)
  await waitForPulseRoot(extension.page)
  const pill = extension.page.locator(`#${PULSE_ROOT_ID} header.pulse-personal-banner h2 + span`)
  await expect(pill).toHaveAttribute('aria-label', 'Offline')
  await expect(extension.page.locator(`#${PULSE_ROOT_ID} .pulse-offline-state`)).toContainText('Channel offline')
  expect(await pulseShadowText(extension.page)).not.toMatch(/Not tracked|Not charted/)
  assertNoUncaughtErrors(evidence)
})
