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
    const sessionStore: Record<string, unknown> = {}
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
        session: {
          get: vi.fn(async (key: string) => ({ [key]: sessionStore[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(sessionStore, items) }),
          remove: vi.fn(async (key: string) => { delete sessionStore[key] }),
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

  it('reports a failed consent read as unavailable and never emits from it', async () => {
    stubLocalStorage({
      'pulse-analytics-consent-v1': { schemaVersion: 1, granted: true, updatedAt: 1 },
    })
    vi.mocked(chrome.storage.local.get).mockRejectedValue(new Error('consent storage unavailable'))
    const consent = await import('../src/shared/analyticsConsent')
    const analytics = await import('../src/shared/extensionAnalytics')
    const transport = vi.fn(async () => undefined)
    analytics.setAnalyticsTransportForTest(transport)
    await expect(consent.readAnalyticsConsentState()).resolves.toBe('unavailable')
    await expect(consent.isAnalyticsConsentGranted()).resolves.toBe(false)
    await analytics.emitAnalyticsEvents([analytics.ANALYTICS_EVENT_PULSE_LOAD_COMPLETED], { ingestEnabled: true })
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
    }, expect.any(AbortSignal))
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

  it('does not send an event when withdrawal completes during a pending consent read', async () => {
    stubLocalStorage()
    const { setAnalyticsConsentGranted } = await import('../src/shared/analyticsConsent')
    await setAnalyticsConsentGranted(true)

    let resumeRead!: () => void
    let readStarted!: () => void
    const readPaused = new Promise<void>(resolve => { readStarted = resolve })
    const resume = new Promise<void>(resolve => { resumeRead = resolve })
    const get = chrome.storage.local.get
    vi.mocked(get).mockImplementationOnce(async keys => {
      const snapshot = await get(keys)
      readStarted()
      await resume
      return snapshot
    })

    const transport = vi.fn(async () => undefined)
    const { emitAnalyticsEvents, setAnalyticsTransportForTest, ANALYTICS_EVENT_PULSE_LOAD_COMPLETED } =
      await import('../src/shared/extensionAnalytics')
    setAnalyticsTransportForTest(transport)

    const pending = emitAnalyticsEvents([ANALYTICS_EVENT_PULSE_LOAD_COMPLETED], { ingestEnabled: true })
    await readPaused
    await setAnalyticsConsentGranted(false)
    resumeRead()
    await pending
    expect(transport).not.toHaveBeenCalled()
  })

  it('cancels pending analytics transport work when consent is withdrawn', async () => {
    stubLocalStorage()
    const { setAnalyticsConsentGranted } = await import('../src/shared/analyticsConsent')
    await setAnalyticsConsentGranted(true)
    const { emitAnalyticsEvents, setAnalyticsTransportForTest, ANALYTICS_EVENT_PULSE_LOAD_COMPLETED } =
      await import('../src/shared/extensionAnalytics')

    let started!: () => void
    let activeSignal!: AbortSignal
    const transportStarted = new Promise<void>(resolve => { started = resolve })
    setAnalyticsTransportForTest(async (_body, signal) => {
      activeSignal = signal
      started()
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    })

    const pending = emitAnalyticsEvents([ANALYTICS_EVENT_PULSE_LOAD_COMPLETED], { ingestEnabled: true })
    await transportStarted
    await setAnalyticsConsentGranted(false)
    expect(activeSignal.aborted).toBe(true)
    await pending
  })

  it('does not let a delayed grant overwrite a later withdrawal', async () => {
    const store = stubLocalStorage()
    const { setAnalyticsConsentGranted, isAnalyticsConsentGranted, ANALYTICS_CONSENT_STORAGE } =
      await import('../src/shared/analyticsConsent')
    let resumeSet!: () => void
    let setStarted!: () => void
    const setPaused = new Promise<void>(resolve => { setStarted = resolve })
    const resume = new Promise<void>(resolve => { resumeSet = resolve })
    const set = chrome.storage.local.set
    vi.mocked(set).mockImplementationOnce(async items => {
      setStarted()
      await resume
      await set(items)
    })

    const grant = setAnalyticsConsentGranted(true)
    await setPaused
    const withdrawal = setAnalyticsConsentGranted(false)
    resumeSet()
    await expect(grant).rejects.toThrow(/superseded/)
    await withdrawal
    expect(store[ANALYTICS_CONSENT_STORAGE]).toBeUndefined()
    expect(await isAnalyticsConsentGranted()).toBe(false)
  })

  it('routes withdrawal from a separate settings context to the worker that owns pending sends', async () => {
    stubLocalStorage()
    const settingsConsent = await import('../src/shared/analyticsConsent')
    vi.resetModules()
    const workerConsent = await import('../src/shared/analyticsConsent')
    const workerAnalytics = await import('../src/shared/extensionAnalytics')
    await workerConsent.setAnalyticsConsentGranted(true)

    let resumeRead!: () => void
    let readStarted!: () => void
    const readPaused = new Promise<void>(resolve => { readStarted = resolve })
    const resume = new Promise<void>(resolve => { resumeRead = resolve })
    const get = chrome.storage.local.get
    vi.mocked(get).mockImplementationOnce(async keys => {
      const snapshot = await get(keys)
      readStarted()
      await resume
      return snapshot
    })
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async message => {
      expect(message).toEqual({ type: 'SET_ANALYTICS_CONSENT', granted: false })
      await workerConsent.setAnalyticsConsentGranted(false)
      return { ok: true }
    })
    const transport = vi.fn(async () => undefined)
    workerAnalytics.setAnalyticsTransportForTest(transport)
    const pending = workerAnalytics.emitAnalyticsEvents(
      [workerAnalytics.ANALYTICS_EVENT_PULSE_LOAD_COMPLETED], { ingestEnabled: true },
    )
    await readPaused
    await settingsConsent.requestAnalyticsConsentChange(false)
    resumeRead()
    await pending
    expect(transport).not.toHaveBeenCalled()
  })

  it('reports a failed worker consent change instead of writing from settings', async () => {
    const store = stubLocalStorage()
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false })
    const { requestAnalyticsConsentChange, ANALYTICS_CONSENT_STORAGE } = await import('../src/shared/analyticsConsent')
    await expect(requestAnalyticsConsentChange(false)).rejects.toThrow(/update_failed/)
    expect(store[ANALYTICS_CONSENT_STORAGE]).toBeUndefined()
    expect(chrome.storage.local.remove).not.toHaveBeenCalled()
  })

  it('does not start the real fetch after withdrawal during backend URL lookup', async () => {
    stubLocalStorage()
    let resumeLookup!: () => void
    let lookupStarted!: () => void
    const lookupPaused = new Promise<void>(resolve => { lookupStarted = resolve })
    const resume = new Promise<void>(resolve => { resumeLookup = resolve })
    Object.assign(chrome.storage, {
      sync: { get: vi.fn(async () => { lookupStarted(); await resume; return {} }) },
    })
    const fetchSpy = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchSpy)
    const { setAnalyticsConsentGranted } = await import('../src/shared/analyticsConsent')
    const { emitAnalyticsEvents, ANALYTICS_EVENT_PULSE_LOAD_COMPLETED } = await import('../src/shared/extensionAnalytics')
    await setAnalyticsConsentGranted(true)
    const pending = emitAnalyticsEvents([ANALYTICS_EVENT_PULSE_LOAD_COMPLETED], { ingestEnabled: true })
    await lookupPaused
    await setAnalyticsConsentGranted(false)
    resumeLookup()
    await pending
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('aborts the real fetch when consent is withdrawn after it starts', async () => {
    stubLocalStorage()
    Object.assign(chrome.storage, { sync: { get: vi.fn(async () => ({})) } })
    let fetchStarted!: () => void
    let fetchSignal!: AbortSignal
    const started = new Promise<void>(resolve => { fetchStarted = resolve })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      fetchSignal = init.signal as AbortSignal
      fetchStarted()
      await new Promise<void>(resolve => fetchSignal.addEventListener('abort', () => resolve(), { once: true }))
      throw new DOMException('Aborted', 'AbortError')
    }))
    const { setAnalyticsConsentGranted } = await import('../src/shared/analyticsConsent')
    const { emitAnalyticsEvents, ANALYTICS_EVENT_PULSE_LOAD_COMPLETED } = await import('../src/shared/extensionAnalytics')
    await setAnalyticsConsentGranted(true)
    const pending = emitAnalyticsEvents([ANALYTICS_EVENT_PULSE_LOAD_COMPLETED], { ingestEnabled: true })
    await started
    await setAnalyticsConsentGranted(false)
    expect(fetchSignal.aborted).toBe(true)
    await pending
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

  it('persists an off record when removing consent fails', async () => {
    stubLocalStorage()
    const {
      setAnalyticsConsentGranted,
      isAnalyticsConsentGranted,
    } = await import('../src/shared/analyticsConsent')
    await setAnalyticsConsentGranted(true)

    // Re-stub with remove throwing while granted record exists.
    vi.unstubAllGlobals()
    const store = stubLocalStorage(
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
    await consent.setAnalyticsConsentGranted(false)
    expect(await consent.isAnalyticsConsentGranted()).toBe(false)
    expect(store['pulse-analytics-consent-v1']).toMatchObject({ granted: false, schemaVersion: 1 })
    vi.resetModules()
    const restarted = await import('../src/shared/analyticsConsent')
    expect(await restarted.isAnalyticsConsentGranted()).toBe(false)
  })

  it('reports failure and denies in memory when both removal and the off-record write fail', async () => {
    stubLocalStorage({
      'pulse-analytics-consent-v1': { schemaVersion: 1, granted: true, updatedAt: Date.now() },
    }, { removeThrows: true, setThrows: true })
    const consent = await import('../src/shared/analyticsConsent')
    await expect(consent.setAnalyticsConsentGranted(false)).rejects.toThrow(/storage_set_failed/)
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
