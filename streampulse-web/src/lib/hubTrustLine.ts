/**
 * Command-center trust line freshness — never claims LIVE while unhealthy/stale.
 */

export type HubTrustFreshness = 'live' | 'delayed' | 'reconnecting'

export const HUB_TRUST_LIVE_MS = 60_000
export const HUB_TRUST_DELAYED_MS = 3 * 60_000

export interface ResolveHubTrustInput {
  lastSuccessfulPollAt: number | null
  hubEndpointOk: boolean
  hasError: boolean
  nowMs?: number
}

export function resolveHubTrustFreshness(input: ResolveHubTrustInput): HubTrustFreshness {
  const now = input.nowMs ?? Date.now()
  if (!input.lastSuccessfulPollAt) return 'reconnecting'
  if (input.hasError || !input.hubEndpointOk) {
    const age = now - input.lastSuccessfulPollAt
    if (age >= HUB_TRUST_LIVE_MS) return 'reconnecting'
    return 'delayed'
  }
  const age = now - input.lastSuccessfulPollAt
  if (age <= HUB_TRUST_LIVE_MS) return 'live'
  if (age <= HUB_TRUST_DELAYED_MS) return 'delayed'
  return 'reconnecting'
}

export function formatTrustAge(lastSuccessfulPollAt: number, nowMs = Date.now()): string {
  const sec = Math.max(0, Math.floor((nowMs - lastSuccessfulPollAt) / 1000))
  if (sec < 60) return `${sec}S AGO`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}M AGO`
  const hr = Math.floor(min / 60)
  return `${hr}H AGO`
}

export function formatHubTrustLine(input: {
  collectorActive: number
  collectorMax: number
  lastSuccessfulPollAt: number | null
  freshness: HubTrustFreshness
  nowMs?: number
}): string {
  const now = input.nowMs ?? Date.now()
  const coverage =
    input.collectorMax > 0
      ? `IRC COVERAGE ${input.collectorActive}/${input.collectorMax}`
      : 'IRC COVERAGE —'

  if (input.freshness === 'reconnecting') {
    if (input.lastSuccessfulPollAt) {
      return `LAST GOOD UPDATE ${formatTrustAge(input.lastSuccessfulPollAt, now)} · RECONNECTING`
    }
    return 'RECONNECTING'
  }

  const updated = input.lastSuccessfulPollAt
    ? `UPDATED ${formatTrustAge(input.lastSuccessfulPollAt, now)}`
    : 'UPDATED —'
  const status = input.freshness === 'live' ? 'LIVE' : 'DELAYED'
  return `${coverage} · ${updated} · ${status}`
}
