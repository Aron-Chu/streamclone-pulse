import { describe, expect, it, vi } from 'vitest'
import {
  CHAT_MESSAGE_LIST_IGNORE_SELECTORS,
  CHAT_TRANSITION_REMEASURE_FRAMES,
  createFiniteFrameRemeasurer,
  matchesChatMessageListAncestry,
  shouldScheduleChatGeometryFromMutations,
} from '../src/content/twitchChat.ts'

/**
 * Guards the MutationObserver noise filter. Measured impact: with this filter the
 * document-wide live-state sync ran 30x during a 15s / 600-message chat storm
 * (the 500ms backstop poll only); without it, 630x — once per chat message.
 */
describe('matchesChatMessageListAncestry', () => {
  it('ignores mutations inside every known chat message list container', () => {
    expect(CHAT_MESSAGE_LIST_IGNORE_SELECTORS.length).toBeGreaterThan(0)
    for (const selector of CHAT_MESSAGE_LIST_IGNORE_SELECTORS) {
      const closest = (candidate: string) => (candidate === selector ? {} : null)
      expect(matchesChatMessageListAncestry(closest)).toBe(true)
    }
  })

  it('keeps mutations that are outside the chat message list', () => {
    expect(matchesChatMessageListAncestry(() => null)).toBe(false)
  })

  it('treats an unsupported selector as a non-match instead of throwing', () => {
    expect(() =>
      matchesChatMessageListAncestry(() => {
        throw new SyntaxError('unsupported selector')
      }),
    ).not.toThrow()
    expect(
      matchesChatMessageListAncestry(() => {
        throw new SyntaxError('unsupported selector')
      }),
    ).toBe(false)
  })

  it('covers the accessibility chat log role', () => {
    expect(CHAT_MESSAGE_LIST_IGNORE_SELECTORS).toContain('[role="log"]')
  })
})

function mutationTarget(input: {
  closest?: (selector: string) => unknown
  matches?: (selector: string) => boolean
  querySelector?: (selector: string) => unknown
}): Node {
  return {
    nodeType: 1,
    parentElement: null,
    closest: input.closest ?? (() => null),
    matches: input.matches ?? (() => false),
    querySelector: input.querySelector ?? (() => null),
  } as unknown as Node
}

describe('shouldScheduleChatGeometryFromMutations', () => {
  const messageListSelector = CHAT_MESSAGE_LIST_IGNORE_SELECTORS[0]
  const chatColumnSelector = '[data-test-selector="chat-room-component-layout"]'

  it('ignores ordinary message insertion and message-node attribute churn', () => {
    const messageDescendant = mutationTarget({
      closest: selector => selector === messageListSelector ? {} : null,
    })
    expect(shouldScheduleChatGeometryFromMutations([
      { target: messageDescendant, type: 'childList' },
      { target: messageDescendant, type: 'attributes' },
    ])).toBe(false)
  })

  it('keeps attributes on the message-list container because they can move it', () => {
    const messageList = mutationTarget({
      closest: selector => selector === messageListSelector ? {} : null,
      matches: selector => selector === messageListSelector,
    })
    expect(shouldScheduleChatGeometryFromMutations([
      { target: messageList, type: 'attributes' },
    ])).toBe(true)
  })

  it('keeps chat topology and scoped ancestor attribute changes', () => {
    const chatDescendant = mutationTarget({
      closest: selector => selector === chatColumnSelector ? {} : null,
    })
    const chatAncestor = mutationTarget({
      querySelector: selector => selector === chatColumnSelector ? {} : null,
    })
    expect(shouldScheduleChatGeometryFromMutations([
      { target: chatDescendant, type: 'childList' },
    ])).toBe(true)
    expect(shouldScheduleChatGeometryFromMutations([
      { target: chatAncestor, type: 'attributes' },
    ])).toBe(true)
  })

  it('ignores unrelated attribute churn outside chat', () => {
    expect(shouldScheduleChatGeometryFromMutations([
      { target: mutationTarget({}), type: 'attributes' },
    ])).toBe(false)
  })
})

describe('createFiniteFrameRemeasurer', () => {
  it('remeasures through a finite transition frame budget', () => {
    const callbacks: FrameRequestCallback[] = []
    const measure = vi.fn()
    const remeasurer = createFiniteFrameRemeasurer(measure, {
      requestAnimationFrame: callback => {
        callbacks.push(callback)
        return callbacks.length
      },
      cancelAnimationFrame: vi.fn(),
    })

    remeasurer.schedule(CHAT_TRANSITION_REMEASURE_FRAMES)
    for (let frame = 0; frame < CHAT_TRANSITION_REMEASURE_FRAMES; frame += 1) {
      expect(callbacks).toHaveLength(frame + 1)
      callbacks[frame](frame)
    }

    expect(measure).toHaveBeenCalledTimes(CHAT_TRANSITION_REMEASURE_FRAMES)
    expect(callbacks).toHaveLength(CHAT_TRANSITION_REMEASURE_FRAMES)
    remeasurer.dispose()
  })

  it('coalesces overlapping requests and cancels cleanup work', () => {
    const callbacks: FrameRequestCallback[] = []
    const cancelAnimationFrame = vi.fn()
    const remeasurer = createFiniteFrameRemeasurer(vi.fn(), {
      requestAnimationFrame: callback => {
        callbacks.push(callback)
        return 41
      },
      cancelAnimationFrame,
    })

    remeasurer.schedule(2)
    remeasurer.schedule(5)
    expect(callbacks).toHaveLength(1)
    remeasurer.dispose()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41)
  })
})
