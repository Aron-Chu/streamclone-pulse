// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ChatBadgeList } from '../src/background/chatBadgeList.ts'
import { ChatBadgeDecorator } from '../src/content/chatBadgeDom.ts'
import { chatContainer, chatLine, FIXTURE_LIST, FIXTURE_PEOPLE } from './fixtures/chat-badges/chatMarkup.ts'
import { makeDoc, publicKeyFor, signList, TEST_KID } from './helpers/chatBadgeSigner.ts'

const NOW = 1_800_000_000

describe('shared supporter appearance, offline proof', () => {
  it('shows a verified supporter to two viewers and removes them after the next signed list', async () => {
    let payload = signList(makeDoc([FIXTURE_LIST[0]], { iat: NOW - 60, seq: 1 }))
    let nowMs = NOW * 1000
    const fetchList = vi.fn(async () => new Response(payload, { status: 200 }))
    const makeViewer = (style: 'native' | '7tv') => {
      const doc = document.implementation.createHTMLDocument('local fixture')
      doc.body.innerHTML = chatContainer(style, chatLine(style, FIXTURE_PEOPLE[0]))
      let stored: unknown
      const worker = new ChatBadgeList({
        fetch: fetchList as unknown as typeof globalThis.fetch,
        origin: 'https://example.invalid',
        keys: () => [{ kid: TEST_KID, key: publicKeyFor() }],
        environments: ['sandbox'],
        subtle: webcrypto.subtle as unknown as SubtleCrypto,
        now: () => nowMs,
        random: () => 0.5,
        read: async () => stored,
        write: async value => { stored = value },
        enabled: async () => true,
      })
      return { doc, worker, decorator: new ChatBadgeDecorator(doc) }
    }
    const viewers = [makeViewer('native'), makeViewer('7tv')]
    try {
      for (const viewer of viewers) {
        const result = await viewer.worker.ask()
        expect(result).toHaveProperty('u')
        if (!('u' in result)) throw new Error('fixture list was not accepted')
        viewer.decorator.setList(result.u)
        viewer.decorator.start()
        expect(viewer.doc.querySelector('.sp-cb-crest')).not.toBeNull()
        expect(viewer.doc.querySelector('[data-sp-paint="1"]')).not.toBeNull()
      }

      // Simulate publication of a newer list after that supporter opts out.
      nowMs += 1_000
      payload = signList(makeDoc([], { iat: NOW, seq: 2 }))
      for (const viewer of viewers) {
        await viewer.worker.refresh()
        const result = await viewer.worker.ask()
        expect(result).toEqual({ type: 'CHAT_BADGES', off: true })
        viewer.decorator.setList([])
        expect(viewer.doc.querySelector('.sp-cb-crest')).toBeNull()
        expect(viewer.doc.querySelector('[data-sp-paint]')).toBeNull()
      }
      expect(fetchList).toHaveBeenCalledTimes(4)
    } finally {
      for (const viewer of viewers) viewer.decorator.stop()
    }
  })
})
