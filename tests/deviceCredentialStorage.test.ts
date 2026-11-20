import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_BACKEND_URL, DEVICE_CREDENTIAL_REVISION_KEY } from '../src/shared/storage.ts'
import type { DeviceCredential } from '../src/background/deviceAuth.ts'
import { readPrivateRecord, writePrivateRecord } from '../src/background/privateExtensionStorage.ts'

vi.mock('../src/background/privateExtensionStorage.ts', () => ({
  readPrivateRecord: vi.fn(), writePrivateRecord: vi.fn(),
}))

const key = `deviceCredential:${DEFAULT_BACKEND_URL}`
const legacy: DeviceCredential = {
  token: `spdev_${'a'.repeat(64)}`, principalId: 'c'.repeat(64), deviceId: `dev_${'b'.repeat(32)}`,
  expiresAt: '2100-01-01T00:00:00Z', principalKind: 'device',
}
const rotated = { ...legacy, token: `spdev_${'d'.repeat(64)}` }
let shared: Record<string, unknown>
let privateRecords: Map<string, unknown>
const remove = vi.fn(async (k: string) => { delete shared[k] })
const set = vi.fn(async (values: Record<string, unknown>) => { Object.assign(shared, values) })
const auth = () => import('../src/background/deviceAuth.ts')

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  shared = { [key]: legacy, overlaySetting: true }
  privateRecords = new Map()
  vi.mocked(readPrivateRecord).mockImplementation(async k => privateRecords.get(k))
  vi.mocked(writePrivateRecord).mockImplementation(async (k, v) => { privateRecords.set(k, v) })
  vi.stubGlobal('chrome', { storage: { local: {
    get: async (k: string) => k in shared ? { [k]: shared[k] } : {},
    set, remove,
  } } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('serializes migration and rotation, preserves settings and publishes only a revision', async () => {
  const device = await auth()
  const [first] = await Promise.all([device.getDeviceCredential(), device.setDeviceCredential(rotated)])
  expect(first).toEqual(legacy)
  expect(await device.getDeviceCredential()).toEqual(rotated)
  expect(shared).toEqual({ overlaySetting: true, [DEVICE_CREDENTIAL_REVISION_KEY]: expect.any(String) })
  vi.resetModules()
  expect(await (await auth()).getDeviceCredential()).toEqual(rotated)
})

it('keeps the only copy on a private write failure and retries without returning a shared bearer', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(writePrivateRecord).mockRejectedValueOnce(new Error('storage unavailable'))
    .mockRejectedValueOnce(new Error('still unavailable'))
  const device = await auth()
  expect(await device.getDeviceCredential()).toBeNull()
  expect(await device.getDeviceCredential()).toBeNull()
  expect(shared[key]).toEqual(legacy)
  expect(remove).not.toHaveBeenCalled()
  expect(warn).toHaveBeenCalledWith('device_credential_storage_unavailable')
  expect(warn).toHaveBeenCalledTimes(1)
  expect(await device.getDeviceCredential()).toEqual(legacy)
  expect(shared[key]).toBeUndefined()
})

it('retains a committed rotation when the settings notification fails', async () => {
  set.mockRejectedValueOnce(new Error('settings unavailable'))
  const device = await auth()
  await device.setDeviceCredential(rotated)
  vi.resetModules()
  expect(await (await auth()).getDeviceCredential()).toEqual(rotated)
  expect(shared).toEqual({ overlaySetting: true })
})

it('resumes interrupted cleanup with the committed record authoritative', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  remove.mockRejectedValueOnce(new Error('interrupted'))
  const device = await auth()
  expect(await device.getDeviceCredential()).toBeNull()
  expect(privateRecords.get(key)).toEqual(legacy)
  shared[key] = rotated
  vi.resetModules()
  expect(await (await auth()).getDeviceCredential()).toEqual(legacy)
  expect(shared[key]).toBeUndefined()
})

it('never re-imports a shared credential after revocation and a cold start', async () => {
  const device = await auth()
  await device.clearDeviceCredential()
  const revision = shared[DEVICE_CREDENTIAL_REVISION_KEY]
  expect(revision).toEqual(expect.any(String))
  shared[key] = legacy
  vi.resetModules()
  expect(await (await auth()).getDeviceCredential()).toBeNull()
  expect(shared[key]).toBeUndefined()
})

it.each([
  { ...legacy, expiresAt: '2000-01-01T00:00:00Z' }, { token: 'malformed' },
])('discards an unusable legacy record', async invalid => {
  shared[key] = invalid
  expect(await (await auth()).getDeviceCredential()).toBeNull()
  expect(shared[key]).toBeUndefined()
  expect(privateRecords.get(key)).toBe(false)
})

it('clears an expired private record even if the shared copy still looks live', async () => {
  privateRecords.set(key, { ...legacy, expiresAt: '2000-01-01T00:00:00Z' })
  expect(await (await auth()).getDeviceCredential()).toBeNull()
  expect(privateRecords.get(key)).toBe(false)
  expect(shared[key]).toBeUndefined()
})
