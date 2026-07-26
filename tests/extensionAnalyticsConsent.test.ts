import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('extension analytics consent gates', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  function stubLocalStorage(initial: Record<string, unknown> = {}, opts?: { setThrows?: boolean; removeThrows?: boolean }) {
    const store = { ...initial }
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-ext', sendMessage: vi.fn(async () => ({ ok: true })) },
      storage: {
        local: {
          get: vi.fn(async (keys?: string | string[] | null) => {
            if (!keys) return { ...store }
            const list = Array.isArray(keys) ? keys : [keys]
            const out: Record<string, unknown> = {}
            for (const key of list) out[key] = store[key]
            return out
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            if (opts?.setThrows) throw new Error('storage_set_failed')
            Object.assign(store, items)
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            if (opts?.removeThrows) throw new Error('storage_remove_failed')
            const list = Array.isArray(keys) ? keys : [keys]
            for (const key of list) delete store[key]
          }),
        },
      },
    })
    return store
  }

  it('emits zero events without analytics consent even if ingest override is on', async () => {
    stubLocalStorage()
    const transport = vi.fn(async () => undefined)
    const {
      setAnalyticsTransportForTest,
      emitAnalyticsEvents,
      ANALYTICS_EVENT_PULSE_LOAD_COMPLETED,
    } = await import('../src/shared/extensionAnalytics')
    setAnalyticsTransportForTest(transport)

    await emitAnalyticsEvents([ANALYTICS_EVENT_PULSE_LOAD_COMPLETED], { ingestEnabled: true })
    expect(transport).not.toHaveBeenCalled()
  })

  it('does not emit when only diagnostics consent is granted', async () => {
    stubLocalStorage()
    const { setDiagnosticsConsentEnabled } = await import('../src/shared/diagnosticsConsent')
    await setDiagnosticsConsentEnabled(true)

    const transport = vi.fn(async () => undefined)
    const {
      setAnalyticsTransportForTest,
      emitAnalyticsEvents,
      ANALYTICS_EVENT_EXTENSION_ERROR_SHOWN,
      EXTENSION_ANALYTICS_INGEST_ENABLED,
    } = await import('../src/shared/extensionAnalytics')
    setAnalyticsTransportForTest(transport)

    expect(EXTENSION_ANALYTICS_INGEST_ENABLED).toBe(false)
    await emitAnalyticsEvents([ANALYTICS_EVENT_EXTENSION_ERROR_SHOWN], { ingestEnabled: true })
    expect(transport).not.toHaveBeenCalled()
  })

  it('emits only when analytics consent is on and ingest is enabled', async () => {
    stubLocalStorage()
    const { setAnalyticsConsentGranted } = await import('../src/shared/analyticsConsent')
    await setAnalyticsConsentGranted(true)

    const transport = vi.fn(async () => undefined)
    const {
      setAnalyticsTransportForTest,
      emitAnalyticsEvents,
      ANALYTICS_EVENT_PULSE_LOAD_COMPLETED,
      shouldEmitAnalytics,
      EXTENSION_ANALYTICS_INGEST_ENABLED,
    } = await import('../src/shared/extensionAnalytics')
    setAnalyticsTransportForTest(transport)

    expect(EXTENSION_ANALYTICS_INGEST_ENABLED).toBe(false)
    expect(shouldEmitAnalytics({ consentOn: true })).toBe(false)

    await emitAnalyticsEvents([ANALYTICS_EVENT_PULSE_LOAD_COMPLETED], { ingestEnabled: true })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledWith({
      events: [{ name: ANALYTICS_EVENT_PULSE_LOAD_COMPLETED }],
    })
  })

  it('persists analytics consent immediately and readback stays granted', async () => {
    const store = stubLocalStorage()
    const {
      setAnalyticsConsentGranted,
      isAnalyticsConsentGranted,
      ANALYTICS_CONSENT_STORAGE,
    } = await import('../src/shared/analyticsConsent')

    await setAnalyticsConsentGranted(true)
    expect(store[ANALYTICS_CONSENT_STORAGE]).toMatchObject({ granted: true, schemaVersion: 1 })
    expect(await isAnalyticsConsentGranted()).toBe(true)
  })

  it('withdrawal clears storage and stops emits immediately', async () => {
    stubLocalStorage()
    const { setAnalyticsConsentGranted } = await import('../src/shared/analyticsConsent')
    await setAnalyticsConsentGranted(true)

    const transport = vi.fn(async () => undefined)
    const {
      setAnalyticsTransportForTest,
      emitAnalyticsEvents,
      ANALYTICS_EVENT_PULSE_LOAD_COMPLETED,
    } = await import('../src/shared/extensionAnalytics')
    setAnalyticsTransportForTest(transport)

    await setAnalyticsConsentGranted(false)
    await emitAnalyticsEvents([ANALYTICS_EVENT_PULSE_LOAD_COMPLETED], { ingestEnabled: true })
    expect(transport).not.toHaveBeenCalled()
  })

  it('storage set failure denies in-memory and keeps consent off', async () => {
    stubLocalStorage({}, { setThrows: true })
    const {
      setAnalyticsConsentGranted,
      isAnalyticsConsentGranted,
      resetAnalyticsConsentMemoryForTest,
    } = await import('../src/shared/analyticsConsent')

    await expect(setAnalyticsConsentGranted(true)).rejects.toThrow(/storage_set_failed/)
    expect(await isAnalyticsConsentGranted()).toBe(false)
    resetAnalyticsConsentMemoryForTest()
  })

  it('storage remove failure still denies in-memory after withdrawal attempt', async () => {
    stubLocalStorage()
    const {
      setAnalyticsConsentGranted,
      isAnalyticsConsentGranted,
    } = await import('../src/shared/analyticsConsent')
    await setAnalyticsConsentGranted(true)

    // Re-stub with remove throwing while granted record exists.
    vi.unstubAllGlobals()
    stubLocalStorage(
      {
        'pulse-analytics-consent-v1': {
          schemaVersion: 1,
          granted: true,
          updatedAt: Date.now(),
        },
      },
      { removeThrows: true },
    )
    vi.resetModules()
    const consent = await import('../src/shared/analyticsConsent')
    await expect(consent.setAnalyticsConsentGranted(false)).rejects.toThrow(/storage_remove_failed/)
    expect(await consent.isAnalyticsConsentGranted()).toBe(false)
  })

  it('diagnostics consent cannot enable analytics and analytics cannot enable diagnostics', async () => {
    stubLocalStorage()
    const { setAnalyticsConsentGranted, isAnalyticsConsentGranted } = await import('../src/shared/analyticsConsent')
    const {
      setDiagnosticsConsentEnabled,
      isDiagnosticsConsentEnabled,
    } = await import('../src/shared/diagnosticsConsent')

    await setAnalyticsConsentGranted(true)
    expect(await isDiagnosticsConsentEnabled()).toBe(false)

    await setAnalyticsConsentGranted(false)
    await setDiagnosticsConsentEnabled(true)
    expect(await isAnalyticsConsentGranted()).toBe(false)
  })

  it('dedupes pulse_load_completed per in-memory activation latch', async () => {
    stubLocalStorage()
    const { setAnalyticsConsentGranted } = await import('../src/shared/analyticsConsent')
    await setAnalyticsConsentGranted(true)

    const transport = vi.fn(async () => undefined)
    const {
      setAnalyticsTransportForTest,
      emitPulseLoadCompletedOnce,
      resetAnalyticsEmitLatchesForTest,
    } = await import('../src/shared/extensionAnalytics')
    setAnalyticsTransportForTest(transport)

    await emitPulseLoadCompletedOnce({ ingestEnabled: true })
    await emitPulseLoadCompletedOnce({ ingestEnabled: true })
    expect(transport).toHaveBeenCalledTimes(1)

    resetAnalyticsEmitLatchesForTest()
    await emitPulseLoadCompletedOnce({ ingestEnabled: true })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('dedupes extension_error_shown while visible error latch is set', async () => {
    stubLocalStorage()
    const { setAnalyticsConsentGranted } = await import('../src/shared/analyticsConsent')
    await setAnalyticsConsentGranted(true)

    const transport = vi.fn(async () => undefined)
    const {
      setAnalyticsTransportForTest,
      emitExtensionErrorShownOnce,
    } = await import('../src/shared/extensionAnalytics')
    setAnalyticsTransportForTest(transport)

    await emitExtensionErrorShownOnce({ ingestEnabled: true })
    await emitExtensionErrorShownOnce({ ingestEnabled: true })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('keeps support_report_submitted and ingest kill switch disabled', async () => {
    const {
      EXTENSION_ANALYTICS_INGEST_ENABLED,
      ANALYTICS_EVENT_SUPPORT_REPORT_SUBMITTED,
    } = await import('../src/shared/extensionAnalytics')
    expect(EXTENSION_ANALYTICS_INGEST_ENABLED).toBe(false)
    expect(ANALYTICS_EVENT_SUPPORT_REPORT_SUBMITTED).toBe('support_report_submitted')
  })
})
