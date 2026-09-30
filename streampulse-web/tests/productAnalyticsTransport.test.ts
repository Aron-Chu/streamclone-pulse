import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPublicCaptureClient } from '../src/lib/productAnalyticsCapture'

async function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsText(blob)
  })
}

describe('native public capture transport privacy boundary', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('sends only a generated capture API envelope; refused beacons have no fallback, retry or shutdown/unload flush', async () => {
    const beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network is allowed in this test'))
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open')
    const client = createPublicCaptureClient('phc_testonly', () => true)
    client.capturePage('home')
    client.captureCta('home', 'open_analytics')
    expect(beacon).toHaveBeenCalledTimes(2)
    let distinctId: string | undefined
    for (const [url, payload] of beacon.mock.calls as unknown as [string, Blob][]) {
      expect(url).toBe('https://us.i.posthog.com/i/v0/e/')
      expect(payload.type).toBe('application/json')
      const body = await readBlob(payload)
      expect(body).not.toMatch(/private|secret|email|current_url|referrer|session_id|device_id|window_id|pathname/)
      const parsed = JSON.parse(body)
      expect(Object.keys(parsed).sort()).toEqual(['api_key', 'distinct_id', 'event', 'properties', 'timestamp', 'uuid'])
      expect(parsed.api_key).toBe('phc_testonly')
      expect(parsed.distinct_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(parsed.uuid).toMatch(/^[0-9a-f-]{36}$/)
      expect(Number.isNaN(Date.parse(parsed.timestamp))).toBe(false)
      expect(parsed.properties).toEqual({ page_category: 'home',
        ...(parsed.event === 'portal_public_cta_clicked' ? { cta: 'open_analytics' } : {}),
        $process_person_profile: false, $geoip_disable: true,
      })
      if (distinctId) expect(parsed.distinct_id).toBe(distinctId)
      distinctId = parsed.distinct_id
    }
    beacon.mockReturnValue(false)
    client.captureCta('home', 'install_extension')
    expect(beacon).toHaveBeenCalledTimes(3)
    client.stop()
    client.captureCta('home', 'open_analytics')
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('beforeunload'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(beacon).toHaveBeenCalledTimes(3)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhr).not.toHaveBeenCalled()
    expect(Object.keys(localStorage)).toEqual([])
    expect(Object.keys(sessionStorage)).toEqual([])
    expect(document.cookie).toBe('')
  })

  it('rejects unknown categories, CTA values and post-withdrawal calls even at the transport boundary', () => {
    const beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
    let allowed = true
    const client = createPublicCaptureClient('phc_testonly', () => allowed)
    // Deliberately bypass compile-time enums to check runtime filtering.
    client.capturePage('account' as 'home')
    client.captureCta('home', 'private-value' as 'open_analytics')
    expect(beacon).not.toHaveBeenCalled()
    allowed = false
    client.capturePage('home')
    expect(beacon).not.toHaveBeenCalled()
    allowed = true
    client.stop()
    client.capturePage('home')
    expect(beacon).not.toHaveBeenCalled()
  })

  it('drops thrown beacons and generates a new identifier after the previous client stops', async () => {
    const beacon = vi.fn(() => { throw new Error('No beacon capacity') })
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
    const first = createPublicCaptureClient('phc_testonly', () => true)
    expect(() => first.capturePage('home')).not.toThrow()
    first.stop()
    const second = createPublicCaptureClient('phc_testonly', () => true)
    expect(() => second.capturePage('home')).not.toThrow()
    const calls = beacon.mock.calls as unknown as [string, Blob][]
    expect(JSON.parse(await readBlob(calls[0]![1])).distinct_id).not.toBe(JSON.parse(await readBlob(calls[1]![1])).distinct_id)
    second.stop()
  })
})
