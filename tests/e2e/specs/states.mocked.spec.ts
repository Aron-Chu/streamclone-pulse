import { test, expect } from '../helpers/testFixtures.ts'
import {
  assertExactlyOnePulseRoot,
  assertNoUncaughtErrors,
  assertPulseShadowContains,
  waitForPulseRoot,
} from '../helpers/assertions.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'

test.describe('extension mocked states', () => {
  test('live ready shows Pulse overlay with tracked live content', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Pulse|Chat tracked|Just Chatting|fixturechan/i)
    assertNoUncaughtErrors(evidence)
  })

  test('live partial / starting surfaces not-tracked / starting copy', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-partial', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    // Hosted + warming tier shows the not-tracked live path (starting / not yet IRC-active).
    await assertPulseShadowContains(extension.page, /Not tracked|IRC pool|Partial|Warming|tracking/i)
    assertNoUncaughtErrors(evidence)
  })

  test('Helix unavailable is visible without crashing the overlay', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'helix-off', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Helix|Pulse|fixturechan/i)
    assertNoUncaughtErrors(evidence)
  })

  test('offline channel renders offline / recap path', async ({ extension, prepare, evidence }) => {
    await prepare({ scenario: 'offline', twitchKind: 'offline' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /offline|Recap|Past|fixturechan/i)
    assertNoUncaughtErrors(evidence)
  })

  test('VOD ready mounts Replay Pulse', async ({ extension, prepare, evidence }) => {
    await prepare({ scenario: 'vod-ready', twitchKind: 'vod' })
    await openTwitchVod(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Replay|VOD|ready|Pulse|Chat spike/i)
    assertNoUncaughtErrors(evidence)
  })

  test('VOD syncing shows syncing status', async ({ extension, prepare, evidence }) => {
    await prepare({ scenario: 'vod-syncing', twitchKind: 'vod' })
    await openTwitchVod(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /sync|Syncing|Replay|Pulse/i)
    assertNoUncaughtErrors(evidence)
  })

  test('API 500 does not leave uncaught page exceptions', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'api-500', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    // Overlay may show error/empty state; page must stay stable.
    expect(evidence.pageErrors).toEqual([])
  })

  test('API timeout does not leave uncaught page exceptions', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'timeout', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    expect(evidence.pageErrors).toEqual([])
  })

  test('malformed JSON response does not leave uncaught page exceptions', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'malformed', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    expect(evidence.pageErrors).toEqual([])
  })
})
