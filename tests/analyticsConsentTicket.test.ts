import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('worker-owned analytics grant tickets', () => {
  beforeEach(() => vi.resetModules())

  function stores() {
    const local: Record<string, unknown> = {}
    const session: Record<string, unknown> = {}
    const area = (data: Record<string, unknown>) => ({
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(data, value) }),
      remove: vi.fn(async (key: string) => { delete data[key] }),
    })
    return { local, session, localStorage: area(local), sessionStorage: area(session) }
  }

  it('invalidates every outstanding ticket before acknowledging withdrawal', async () => {
    const consent = await import('../src/shared/analyticsConsent.ts')
    const s = stores()
    const first = await consent.issueAnalyticsConsentGrantTicket(s.sessionStorage)
    const second = await consent.issueAnalyticsConsentGrantTicket(s.sessionStorage)
    await consent.setAnalyticsConsentGranted(false, s.localStorage, { ticketStorage: s.sessionStorage })
    for (const ticket of [first, second]) {
      await expect(consent.setAnalyticsConsentGranted(true, s.localStorage, {
        requireGrantTicket: true, grantTicket: ticket, ticketStorage: s.sessionStorage,
      })).rejects.toThrow(/superseded/)
    }
    expect(s.local['pulse-analytics-consent-v1']).toBeUndefined()
  })

  it('consumes a ticket only once', async () => {
    const consent = await import('../src/shared/analyticsConsent.ts')
    const s = stores()
    const ticket = await consent.issueAnalyticsConsentGrantTicket(s.sessionStorage)
    const options = { requireGrantTicket: true, grantTicket: ticket, ticketStorage: s.sessionStorage }
    await consent.setAnalyticsConsentGranted(true, s.localStorage, options)
    await expect(consent.setAnalyticsConsentGranted(true, s.localStorage, options)).rejects.toThrow(/superseded/)
  })

  it('retains valid tickets across worker restart but not after withdrawal', async () => {
    const firstWorker = await import('../src/shared/analyticsConsent.ts')
    const s = stores()
    const valid = await firstWorker.issueAnalyticsConsentGrantTicket(s.sessionStorage)
    const revoked = await firstWorker.issueAnalyticsConsentGrantTicket(s.sessionStorage)
    vi.resetModules()
    const restartedWorker = await import('../src/shared/analyticsConsent.ts')
    await restartedWorker.setAnalyticsConsentGranted(true, s.localStorage, {
      requireGrantTicket: true, grantTicket: valid, ticketStorage: s.sessionStorage,
    })
    await restartedWorker.setAnalyticsConsentGranted(false, s.localStorage, { ticketStorage: s.sessionStorage })
    vi.resetModules()
    const restartedAgain = await import('../src/shared/analyticsConsent.ts')
    await expect(restartedAgain.setAnalyticsConsentGranted(true, s.localStorage, {
      requireGrantTicket: true, grantTicket: revoked, ticketStorage: s.sessionStorage,
    })).rejects.toThrow(/superseded/)
  })

  it('bounds unused tickets and rejects evicted tickets', async () => {
    const consent = await import('../src/shared/analyticsConsent.ts')
    const s = stores()
    const tickets: string[] = []
    for (let i = 0; i < 65; i++) tickets.push(await consent.issueAnalyticsConsentGrantTicket(s.sessionStorage))
    await expect(consent.setAnalyticsConsentGranted(true, s.localStorage, {
      requireGrantTicket: true, grantTicket: tickets[0], ticketStorage: s.sessionStorage,
    })).rejects.toThrow(/superseded/)
    await consent.setAnalyticsConsentGranted(true, s.localStorage, {
      requireGrantTicket: true, grantTicket: tickets[64], ticketStorage: s.sessionStorage,
    })
  })

  it('reports failure if both session-ticket invalidation operations fail', async () => {
    const consent = await import('../src/shared/analyticsConsent.ts')
    const s = stores()
    await consent.issueAnalyticsConsentGrantTicket(s.sessionStorage)
    s.sessionStorage.remove.mockRejectedValueOnce(new Error('remove failed'))
    s.sessionStorage.set.mockRejectedValueOnce(new Error('set failed'))
    await expect(consent.setAnalyticsConsentGranted(false, s.localStorage, { ticketStorage: s.sessionStorage }))
      .rejects.toThrow(/ticket_clear_failed/)
    expect(s.local['pulse-analytics-consent-v1']).toBeUndefined()
    await expect(consent.isAnalyticsConsentGranted(s.localStorage)).resolves.toBe(false)
  })

  it('falls back to an empty session list if ticket removal alone fails', async () => {
    const consent = await import('../src/shared/analyticsConsent.ts')
    const s = stores()
    const ticket = await consent.issueAnalyticsConsentGrantTicket(s.sessionStorage)
    s.sessionStorage.remove.mockRejectedValueOnce(new Error('remove failed'))
    await consent.setAnalyticsConsentGranted(false, s.localStorage, { ticketStorage: s.sessionStorage })
    vi.resetModules()
    const restarted = await import('../src/shared/analyticsConsent.ts')
    await expect(restarted.setAnalyticsConsentGranted(true, s.localStorage, {
      requireGrantTicket: true, grantTicket: ticket, ticketStorage: s.sessionStorage,
    })).rejects.toThrow(/superseded/)
  })

  it('rejects a preparation interrupted by withdrawal while its session write is pending', async () => {
    const consent = await import('../src/shared/analyticsConsent.ts')
    const s = stores()
    let resumeWrite!: () => void
    let writeStarted!: () => void
    const started = new Promise<void>(resolve => { writeStarted = resolve })
    const resume = new Promise<void>(resolve => { resumeWrite = resolve })
    const originalSet = s.sessionStorage.set
    s.sessionStorage.set.mockImplementationOnce(async value => {
      writeStarted()
      await resume
      await originalSet(value)
    })
    const preparation = consent.issueAnalyticsConsentGrantTicket(s.sessionStorage)
    const rejected = expect(preparation).rejects.toThrow(/superseded/)
    await started
    const withdrawal = consent.setAnalyticsConsentGranted(false, s.localStorage, { ticketStorage: s.sessionStorage })
    resumeWrite()
    await rejected
    await withdrawal
    expect(s.session['pulse-analytics-grant-tickets']).toBeUndefined()
  })

  it('rejects a ticketed grant interrupted by withdrawal during the local write', async () => {
    const consent = await import('../src/shared/analyticsConsent.ts')
    const s = stores()
    const ticket = await consent.issueAnalyticsConsentGrantTicket(s.sessionStorage)
    let resumeWrite!: () => void
    let writeStarted!: () => void
    const started = new Promise<void>(resolve => { writeStarted = resolve })
    const resume = new Promise<void>(resolve => { resumeWrite = resolve })
    const originalSet = s.localStorage.set
    s.localStorage.set.mockImplementationOnce(async value => {
      writeStarted()
      await resume
      await originalSet(value)
    })
    const grant = consent.setAnalyticsConsentGranted(true, s.localStorage, {
      requireGrantTicket: true, grantTicket: ticket, ticketStorage: s.sessionStorage,
    })
    const rejected = expect(grant).rejects.toThrow(/superseded/)
    await started
    const withdrawal = consent.setAnalyticsConsentGranted(false, s.localStorage, { ticketStorage: s.sessionStorage })
    resumeWrite()
    await rejected
    await withdrawal
    expect(s.local['pulse-analytics-consent-v1']).toBeUndefined()
  })

  it('does not grant if session ticket storage cannot be read or updated', async () => {
    const consent = await import('../src/shared/analyticsConsent.ts')
    const s = stores()
    s.sessionStorage.get.mockRejectedValueOnce(new Error('read failed'))
    await expect(consent.issueAnalyticsConsentGrantTicket(s.sessionStorage)).rejects.toThrow(/read failed/)
    const ticket = await consent.issueAnalyticsConsentGrantTicket(s.sessionStorage)
    s.sessionStorage.set.mockRejectedValueOnce(new Error('write failed'))
    await expect(consent.setAnalyticsConsentGranted(true, s.localStorage, {
      requireGrantTicket: true, grantTicket: ticket, ticketStorage: s.sessionStorage,
    })).rejects.toThrow(/write failed/)
    expect(s.local['pulse-analytics-consent-v1']).toBeUndefined()
  })
})
