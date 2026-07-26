import { test } from '@playwright/test'

/**
 * Live Twitch canary stubs — not a PR release gate.
 * Execute later with: npx playwright test --project=live-twitch
 */
test.describe('live Twitch canary stubs @live-twitch', () => {
  test.skip(true, 'Live Twitch canary is follow-up work; not part of the mocked PR gate.')

  test('canary: live tracked channel on real Twitch', async () => {
    // Follow-up: persistent context + real twitch.tv + hosted API read-only checks.
  })

  test('canary: offline channel on real Twitch', async () => {
    // Follow-up.
  })

  test('canary: VOD Replay Pulse on real Twitch', async () => {
    // Follow-up.
  })
})
