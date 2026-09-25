import { describe, expect, it, vi } from 'vitest'
import { getUpdateCheckCapability, requestBrowserUpdateCheck } from '../src/background/extensionUpdateCheck.ts'

describe('browser update checks', () => {
  it('reports development and unsupported browser capabilities without making a request', () => {
    const requestUpdateCheck = vi.fn()
    expect(getUpdateCheckCapability({ storeBuild: false, runtime: { requestUpdateCheck } })).toEqual({
      type: 'UPDATE_CHECK_CAPABILITY', supported: false, managedBy: 'development',
    })
    expect(getUpdateCheckCapability({ storeBuild: true, runtime: {} })).toEqual({
      type: 'UPDATE_CHECK_CAPABILITY', supported: false, managedBy: 'browser',
    })
    expect(requestUpdateCheck).not.toHaveBeenCalled()
  })

  it.each([
    ['no_update', 'current'],
    ['current', 'current'],
    ['update_available', 'update_available'],
    ['throttled', 'throttled'],
  ] as const)('maps %s to %s', async (browserStatus, status) => {
    const requestUpdateCheck = vi.fn(async () => ({ status: browserStatus, version: '0.3.0' }))
    await expect(requestBrowserUpdateCheck({ storeBuild: true, runtime: { requestUpdateCheck } })).resolves.toMatchObject({
      type: 'UPDATE_CHECK', status,
    })
    expect(requestUpdateCheck).toHaveBeenCalledTimes(1)
  })

  it('returns unsupported or error without throwing', async () => {
    await expect(requestBrowserUpdateCheck({ storeBuild: true, runtime: {} })).resolves.toEqual({ type: 'UPDATE_CHECK', status: 'unsupported' })
    await expect(requestBrowserUpdateCheck({
      storeBuild: true,
      runtime: { requestUpdateCheck: vi.fn(async () => { throw new Error('blocked') }) },
    })).resolves.toMatchObject({ type: 'UPDATE_CHECK', status: 'error', error: 'blocked' })
  })
})
