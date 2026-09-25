// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AccountConnection } from '../src/options/AccountConnection.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('links through the worker, polls at the requested interval, and stops on unmount', async () => {
  vi.useFakeTimers()
  const pending = { state: 'pending', code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600000).toISOString(), retryAfterSeconds: 5 }
  const send = vi.fn().mockResolvedValueOnce({ type: 'SUPPORTER_ACCOUNT', account: { state: 'signed_out' } })
    .mockResolvedValue({ type: 'SUPPORTER_ACCOUNT', account: pending })
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  let unmounted = false
  try {
    await act(async () => root.render(<AccountConnection />))
    expect(send).toHaveBeenCalledTimes(1)
    await act(async () => host.querySelector('button')!.click())
    expect(send).toHaveBeenLastCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'start' })
    expect(host.textContent).toContain('ABCDE-12345')
    expect(host.querySelector('a')?.href).toBe('https://streampulse.stream/account/link-device')
    await act(async () => { await vi.advanceTimersByTimeAsync(4999) })
    expect(send).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(send).toHaveBeenLastCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'poll' })
    send.mockResolvedValueOnce({ type: 'SUPPORTER_ACCOUNT', account: { state: 'signed_out' } })
    await act(async () => host.querySelector('button')!.click())
    expect(send).toHaveBeenLastCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'cancel' })
    expect(host.textContent).not.toContain('ABCDE-12345')
    act(() => root.unmount()); unmounted = true
    const count = send.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(send).toHaveBeenCalledTimes(count)
  } finally {
    if (!unmounted) act(() => root.unmount())
    host.remove(); vi.useRealTimers(); vi.unstubAllGlobals()
  }
})

it('does not claim a subscription or successful remote revocation from local connection state', async () => {
  const send = vi.fn().mockResolvedValueOnce({ type: 'SUPPORTER_ACCOUNT', account: { state: 'linked', accountId: 'fixture', expiresAt: new Date().toISOString() } })
    .mockResolvedValueOnce({ type: 'SUPPORTER_ACCOUNT', account: { state: 'error' } })
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<AccountConnection />))
    expect(host.textContent).toContain('does not confirm a subscription')
    await act(async () => host.querySelector('button')!.click())
    expect(send).toHaveBeenLastCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'disconnect' })
    expect(host.textContent).toContain('server revocation could not be confirmed')
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})

it('offers revocation retry after reopening settings with a pending disconnect', async () => {
  const send = vi.fn().mockResolvedValue({ type: 'SUPPORTER_ACCOUNT', account: { state: 'error', revocationPending: true } })
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<AccountConnection />))
    expect(host.textContent).not.toContain('Link extension')
    const retry = [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry disconnect')
    expect(retry).toBeTruthy()
    await act(async () => retry!.click())
    expect(send).toHaveBeenLastCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'disconnect' })
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})

it('keeps a connection waiting on renewal distinct from a missing or unreachable service', async () => {
  const send = vi.fn().mockResolvedValue({ type: 'SUPPORTER_ACCOUNT', account: { state: 'unavailable', reason: 'temporarily_unavailable', linked: true } })
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const buttons = () => [...host.querySelectorAll('button')].map(button => button.textContent)
  try {
    await act(async () => root.render(<AccountConnection />))
    expect(host.textContent).toContain('still connected')
    expect(host.textContent).not.toContain('not available on the server yet')
    expect(buttons()).toEqual(['Disconnect extension', 'Check connection'])
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Check connection')!.click())
    expect(send).toHaveBeenLastCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'status' })
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() }

  for (const [reason, copy] of [['not_deployed', 'not available on the server yet'], ['temporarily_unavailable', 'temporarily unavailable']] as const) {
    const unlinked = vi.fn().mockResolvedValue({ type: 'SUPPORTER_ACCOUNT', account: { state: 'unavailable', reason } })
    vi.stubGlobal('chrome', { runtime: { sendMessage: unlinked } })
    const page = document.createElement('div'); document.body.append(page)
    const view = createRoot(page)
    try {
      await act(async () => view.render(<AccountConnection />))
      expect(page.textContent).toContain(copy)
      expect(page.textContent).not.toContain('still connected')
      expect([...page.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Link extension'])
    } finally { act(() => view.unmount()); page.remove(); vi.unstubAllGlobals() }
  }
})
