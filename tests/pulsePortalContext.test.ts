import { describe, expect, it } from 'vitest'
import { eventPathIncludesNode } from '../src/ui/pulsePortalContext.ts'

describe('eventPathIncludesNode', () => {
  it('returns true when composedPath includes the node', () => {
    const node = { id: 'root' } as unknown as Node
    const child = { id: 'child' } as unknown as Node
    const event = {
      composedPath: () => [child, node],
    } as unknown as Event

    expect(eventPathIncludesNode(event, node)).toBe(true)
    expect(eventPathIncludesNode(event, child)).toBe(true)
  })

  it('returns false when composedPath does not include the node', () => {
    const node = { id: 'root' } as unknown as Node
    const other = { id: 'other' } as unknown as Node
    const event = {
      composedPath: () => [other],
    } as unknown as Event

    expect(eventPathIncludesNode(event, node)).toBe(false)
  })

  it('falls back to contains when composedPath is unavailable', () => {
    const child = { id: 'child' } as unknown as Node
    const node = {
      contains: (target: Node | null) => target === child,
    } as unknown as Node
    const event = { target: child } as unknown as Event

    expect(eventPathIncludesNode(event, node)).toBe(true)
  })

  it('returns false for null node', () => {
    const event = { composedPath: () => [] } as unknown as Event
    expect(eventPathIncludesNode(event, null)).toBe(false)
  })
})
