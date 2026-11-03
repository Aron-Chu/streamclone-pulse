import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const permission = vi.hoisted(() => vi.fn<() => Promise<boolean>>())
vi.mock('../src/shared/firefoxDataConsent.ts', () => ({
  requestFirefoxTechnicalDataConsent: permission,
  hasFirefoxTechnicalDataConsent: vi.fn(async () => true),
}))

describe('analytics consent settings request', () => {
  const ticket = '00000000-0000-4000-8000-000000000001'
  const sendMessage = vi.fn(async () => ({ ok: true }))
  beforeEach(() => {
    vi.resetModules()
    permission.mockReset()
    sendMessage.mockClear()
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('requests browser permission before asking the worker to grant', async () => {
    permission.mockResolvedValue(true)
    const { requestAnalyticsConsentChange } = await import('../src/shared/analyticsConsent.ts')
    await requestAnalyticsConsentChange(true, ticket)
    expect(permission).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket: ticket })
    expect(permission.mock.invocationCallOrder[0]).toBeLessThan(sendMessage.mock.invocationCallOrder[0])
  })

  it('does not ask the worker to grant when browser permission is denied', async () => {
    permission.mockResolvedValue(false)
    const { requestAnalyticsConsentChange } = await import('../src/shared/analyticsConsent.ts')
    await expect(requestAnalyticsConsentChange(true, ticket)).rejects.toThrow(/platform_permission_denied/)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('does not send an older grant after a later withdrawal while permission is pending', async () => {
    let finishPermission!: (granted: boolean) => void
    permission.mockImplementation(() => new Promise(resolve => { finishPermission = resolve }))
    const { requestAnalyticsConsentChange } = await import('../src/shared/analyticsConsent.ts')
    const grant = requestAnalyticsConsentChange(true, ticket)
    await requestAnalyticsConsentChange(false)
    finishPermission(true)
    await expect(grant).rejects.toThrow(/superseded/)
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SET_ANALYTICS_CONSENT', granted: false })
  })

  it('does not let a pending grant from another settings page undo a later withdrawal', async () => {
    let finishPermission!: (granted: boolean) => void
    permission.mockImplementation(() => new Promise(resolve => { finishPermission = resolve }))
    const store: Record<string, unknown> = {}
    const session: Record<string, unknown> = {}
    const pageA = await import('../src/shared/analyticsConsent.ts')
    vi.resetModules()
    const pageB = await import('../src/shared/analyticsConsent.ts')
    vi.resetModules()
    const worker = await import('../src/shared/analyticsConsent.ts')
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async (message: { type: string; granted?: boolean; grantTicket?: string }) => {
          if (message.type === 'PREPARE_ANALYTICS_CONSENT_GRANT') {
            return { ok: true, grantTicket: await worker.issueAnalyticsConsentGrantTicket() }
          }
          try {
            await worker.setAnalyticsConsentGranted(Boolean(message.granted), undefined, {
              requireExistingPlatformPermission: true, requireGrantTicket: Boolean(message.granted), grantTicket: message.grantTicket,
            })
          } catch (error) {
            if (error instanceof Error && error.message === 'analytics_consent_superseded') {
              return { ok: false, error: error.message }
            }
            throw error
          }
          return { ok: true }
        }),
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(store, value) }),
          remove: vi.fn(async (key: string) => { delete store[key] }),
        },
        session: {
          get: vi.fn(async (key: string) => ({ [key]: session[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(session, value) }),
          remove: vi.fn(async (key: string) => { delete session[key] }),
        },
      },
    })
    const prepared = await pageA.prepareAnalyticsConsentGrant()
    const grant = pageA.requestAnalyticsConsentChange(true, prepared)
    await pageB.requestAnalyticsConsentChange(false)
    finishPermission(true)
    await expect(grant).rejects.toThrow(/superseded/)
    expect(store['pulse-analytics-consent-v1']).toBeUndefined()
  })
})
