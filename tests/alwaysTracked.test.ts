import { describe, expect, it, vi } from 'vitest'
import { pageAlwaysTracked } from '../src/background/alwaysTracked.ts'
import type { DeviceCredential } from '../src/background/deviceAuth.ts'

const live = { expiresAt: new Date(Date.now() + 3_600_000).toISOString() } as DeviceCredential
const expired = { expiresAt: new Date(Date.now() - 1_000).toISOString() } as DeviceCredential

function ports(hosted: boolean, credential: DeviceCredential | null) {
  return {
    hosted: vi.fn(async () => hosted),
    credential: vi.fn(async () => credential),
    fetchHosted: vi.fn(async () => ['caseoh_', 'xqc']),
    fetchLocal: vi.fn(async () => ['caseoh_']),
  }
}

describe('GET_ALWAYS_TRACKED for a Twitch page', () => {
  it.each([['no device key', null], ['an expired device key', expired]] as const)('hosted with %s: answers not tracked without a request', async (_label, credential) => {
    const p = ports(true, credential)
    await expect(pageAlwaysTracked('caseoh_', p)).resolves.toEqual([])
    expect(p.fetchHosted).not.toHaveBeenCalled()
    expect(p.fetchLocal).not.toHaveBeenCalled()
  })

  it('hosted with a live device key: asks the watchlist and returns only this channel', async () => {
    const p = ports(true, live)
    await expect(pageAlwaysTracked('caseoh_', p)).resolves.toEqual(['caseoh_'])
    expect(p.fetchHosted).toHaveBeenCalledTimes(1)
  })

  it('a local backend reads its own list and needs no device key', async () => {
    const p = ports(false, null)
    await expect(pageAlwaysTracked('caseoh_', p)).resolves.toEqual(['caseoh_'])
    await expect(pageAlwaysTracked('xqc', p)).resolves.toEqual([])
    expect(p.credential).not.toHaveBeenCalled()
    expect(p.fetchHosted).not.toHaveBeenCalled()
  })
})
