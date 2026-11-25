import { describe, expect, it } from 'vitest'
import { clampToSpan, commentSpan } from '../src/lib/momentCommentSpan'

const at = (iso: string) => Date.parse(iso)
const feedback = (over: { startedAt?: string; endedAt?: string | null; from?: string; to?: string } = {}) => ({
  window: { from: over.from ?? '2026-11-14T10:35:00Z', to: over.to ?? '2026-11-14T10:45:00Z' },
  stream: { login: 'fakechan01', displayName: 'fakechan01', profileImageUrl: '', category: 'fake-pog', startedAt: over.startedAt ?? '2026-11-14T09:00:00Z', endedAt: over.endedAt === undefined ? '2026-11-14T12:00:00Z' : over.endedAt },
})

describe('commentSpan', () => {
  it('is the window with its exclusive end made the last whole second', () => {
    expect(commentSpan(feedback(), at('2026-11-14T13:00:00Z'))).toEqual({ from: at('2026-11-14T10:35:00Z'), to: at('2026-11-14T10:44:59Z') })
  })
  it('starts at the stream start, rounded up to a whole second', () => {
    expect(commentSpan(feedback({ startedAt: '2026-11-14T10:40:30Z' }), 0).from).toBe(at('2026-11-14T10:40:30Z'))
    expect(commentSpan(feedback({ startedAt: '2026-11-14T10:40:30.200Z' }), 0).from).toBe(at('2026-11-14T10:40:31Z'))
  })
  it('ends at the stream end when that is inside the window, rounded down', () => {
    expect(commentSpan(feedback({ endedAt: '2026-11-14T10:41:07.900Z' }), 0).to).toBe(at('2026-11-14T10:41:07Z'))
  })
  it('ends at now while live, rounded down, and never after the window', () => {
    const live = feedback({ endedAt: null })
    expect(commentSpan(live, at('2026-11-14T10:41:30.500Z')).to).toBe(at('2026-11-14T10:41:30Z'))
    expect(commentSpan(live, at('2026-11-14T11:00:00Z')).to).toBe(at('2026-11-14T10:44:59Z'))
  })
  it('is the lower bound alone when it would run backwards (a slow client clock)', () => {
    expect(commentSpan(feedback({ endedAt: null }), at('2026-11-14T10:00:00Z'))).toEqual({ from: at('2026-11-14T10:35:00Z'), to: at('2026-11-14T10:35:00Z') })
  })
  it('clampToSpan moves a time to the nearest end', () => {
    const span = commentSpan(feedback(), 0)
    expect(clampToSpan(at('2026-11-14T10:45:00Z'), span)).toBe(span.to)
    expect(clampToSpan(at('2026-11-14T10:00:00Z'), span)).toBe(span.from)
    expect(clampToSpan(at('2026-11-14T10:40:00Z'), span)).toBe(at('2026-11-14T10:40:00Z'))
  })
})
