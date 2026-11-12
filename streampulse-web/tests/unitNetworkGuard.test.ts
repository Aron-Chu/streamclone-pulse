import { describe, expect, it } from 'vitest'

// tests/setup.ts: unit tests never reach a real API.
describe('unit test network guard', () => {
  it('leaves a request to the live API unanswered until it is aborted', async () => {
    const controller = new AbortController()
    let settled = false
    const read = fetch('https://api.streampulse.stream/v1/public/hub', { signal: controller.signal })
      .finally(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(settled).toBe(false)
    controller.abort(new DOMException('test over', 'AbortError'))
    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
  })
})
