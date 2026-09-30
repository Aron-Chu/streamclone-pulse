import type { PublicCta, PublicPageCategory } from './productAnalytics'

// Public POST-only API: https://posthog.com/docs/api/capture#single-event
const INGEST_ENDPOINT = 'https://us.i.posthog.com/i/v0/e/'
const categories = new Set(['home', 'docs', 'status', 'privacy', 'terms', 'refunds', 'supporter', 'support'])

export interface PublicCaptureClient {
  capturePage(category: PublicPageCategory): void
  captureCta(category: PublicPageCategory, cta: PublicCta): void
  stop(): void
}

/** No SDK, remote configuration, fallback, retry, event queue or unload flush. */
export function createPublicCaptureClient(token: string, permitted: (category: PublicPageCategory) => boolean): PublicCaptureClient {
  let anonymousId: string | undefined = crypto.randomUUID()

  function send(category: PublicPageCategory, cta?: PublicCta): void {
    if (!anonymousId || !categories.has(category) || !permitted(category) ||
      (cta !== undefined && cta !== 'install_extension' && cta !== 'open_analytics')) return
    // Identity, UUID and time are generated here; callers cannot supply arbitrary
    // properties, URLs, form values, persistent identifiers or profile writes.
    const event = {
      api_key: token,
      distinct_id: anonymousId,
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      event: cta === undefined ? 'portal_public_page_viewed' : 'portal_public_cta_clicked',
      properties: {
        page_category: category,
        ...(cta === undefined ? {} : { cta }),
        $process_person_profile: false,
        $geoip_disable: true,
      },
    }
    try {
      // A false return or exception drops the event. Browser-accepted beacons
      // cannot be recalled; withdrawal stops every subsequent attempt.
      navigator.sendBeacon(INGEST_ENDPOINT, new Blob([JSON.stringify(event)], { type: 'application/json' }))
    } catch { /* Best effort only; never fall back to another transport. */ }
  }

  return {
    capturePage: category => send(category),
    captureCta: (category, cta) => send(category, cta),
    stop: () => { anonymousId = undefined },
  }
}
