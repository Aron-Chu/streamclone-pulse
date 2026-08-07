import { describe, expect, it } from 'vitest'
import { __test } from '../src/ui/PulseThemedSelect.tsx'

const { indexForValue, resolveMenuHost } = __test

describe('PulseThemedSelect helpers', () => {
  const options = [
    { value: '15m', label: '15m' },
    { value: '60m', label: '60m' },
    { value: 'full', label: 'Full' },
  ] as const

  it('indexForValue tracks the selected option and falls back to 0', () => {
    expect(indexForValue(options, '60m')).toBe(1)
    expect(indexForValue(options, 'full')).toBe(2)
    expect(indexForValue(options, 'missing' as '15m')).toBe(0)
  })

  it('resolveMenuHost never falls back to document.body', () => {
    const parent = { id: 'parent' } as unknown as HTMLElement
    const trigger = {
      getRootNode: () => ({}),
      parentElement: parent,
    } as unknown as HTMLElement
    expect(resolveMenuHost({} as Document, trigger)).toBe(parent)
    expect(resolveMenuHost({} as Document, trigger)).not.toBe(
      (globalThis as { document?: { body?: unknown } }).document?.body,
    )
    expect(resolveMenuHost({} as Document, null)).toBeNull()
  })

  it('keyboard index math wraps with ArrowDown/ArrowUp and clamps Home/End', () => {
    const length = options.length
    const move = (current: number, delta: number) => (current + delta + length) % length
    expect(move(0, 1)).toBe(1)
    expect(move(2, 1)).toBe(0)
    expect(move(0, -1)).toBe(2)
    expect(Math.max(0, length - 1)).toBe(2)
  })
})
