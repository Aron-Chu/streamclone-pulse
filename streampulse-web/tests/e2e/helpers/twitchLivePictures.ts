import type { Page } from '@playwright/test'

// Two 1x1 pictures that draw different pixels (the Hub spec's pair, 10-31).
const LIVE_PICTURE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const OFFLINE_PICTURE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNISUkBAAJcAS1bGyRYAAAAAElFTkSuQmCC', 'base64')

/**
 * Twitch's live pictures, answered here so no Moments card depends on whether a real
 * channel is live. previews-ttv answers a channel that isn't live with Twitch's offline
 * picture (with CORS headers, as Twitch's do), so the card's check proves it offline;
 * the channels in `live` answer with a different picture, which the check keeps.
 */
export async function answerTwitchLivePictures(page: Page, live: readonly string[] = []): Promise<void> {
  await page.route(/^https:\/\/static-cdn\.jtvnw\.net\/(previews-ttv\/|ttv-static\/404_preview-)/, route => {
    const url = route.request().url()
    const isLive = live.some(login => url.includes(`/previews-ttv/live_user_${login}-`))
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: isLive ? LIVE_PICTURE : OFFLINE_PICTURE,
    })
  })
}
