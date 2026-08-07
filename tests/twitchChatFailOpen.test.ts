import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyTwitchSidebarChromeHides,
  HIDE_RULES,
  LEGACY_MESSAGE_HIDE_SELECTOR_FRAGMENTS,
  MESSAGES_HIDE_RULES,
  PULSE_CHAT_COLUMN_ATTR,
  recoverStaleTwitchSidebarChrome,
  TWITCH_SIDEBAR_HIDE_STYLE_ID,
} from '../src/content/twitchSidebarChrome.ts'

function createFakeDocument() {
  const nodes = new Map<string, { id: string; textContent: string; remove: () => void }>()
  const marked: Array<{ removeAttribute: (name: string) => void }> = []
  const head = {
    appendChild(node: { id: string; textContent: string; remove: () => void }) {
      nodes.set(node.id, node)
      return node
    },
  }
  const doc = {
    head,
    getElementById(id: string) {
      return nodes.get(id) ?? null
    },
    createElement(tag: string) {
      if (tag !== 'style') throw new Error(`unexpected tag ${tag}`)
      const node = {
        id: '',
        textContent: '',
        remove() {
          nodes.delete(node.id)
        },
      }
      return node
    },
    querySelectorAll(selector: string) {
      if (!selector.includes(PULSE_CHAT_COLUMN_ATTR)) return []
      return marked
    },
  }
  return {
    doc: doc as unknown as Document,
    markColumn() {
      const el = {
        attrs: new Map<string, string>([[PULSE_CHAT_COLUMN_ATTR, '1']]),
        removeAttribute(name: string) {
          el.attrs.delete(name)
        },
      }
      marked.push(el)
      return el
    },
    getStyleText() {
      return nodes.get(TWITCH_SIDEBAR_HIDE_STYLE_ID)?.textContent ?? null
    },
    seedLegacyHideStyle() {
      const node = {
        id: TWITCH_SIDEBAR_HIDE_STYLE_ID,
        textContent: `
          [data-a-target="chat-scrollable-area"],
          [role="log"] {
            visibility: hidden !important;
            pointer-events: none !important;
          }
        `,
        remove() {
          nodes.delete(node.id)
        },
      }
      nodes.set(node.id, node)
    },
    hasStyle() {
      return nodes.has(TWITCH_SIDEBAR_HIDE_STYLE_ID)
    },
    markedCount() {
      return marked.filter(el => 'attrs' in el ? (el as { attrs: Map<string, string> }).attrs.has(PULSE_CHAT_COLUMN_ATTR) : true).length
    },
  }
}

describe('fail-open twitch chat chrome', () => {
  it('never injects message-list hide rules', () => {
    expect(MESSAGES_HIDE_RULES).toBe('')
    for (const fragment of LEGACY_MESSAGE_HIDE_SELECTOR_FRAGMENTS) {
      expect(HIDE_RULES).not.toContain(fragment)
    }
    const source = readFileSync('src/content/twitchSidebarChrome.ts', 'utf8')
    expect(source).toContain('intentionally ignored')
    expect(source).not.toMatch(/MESSAGES_HIDE_RULES = `[\s\S]*chat-scrollable-area/)
  })

  it('ignores hideMessages and keeps native chat selectors out of injected CSS', () => {
    const fake = createFakeDocument()
    applyTwitchSidebarChromeHides(true, true, fake.doc)
    const text = fake.getStyleText() ?? ''
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toContain('chat-scrollable-area')
    expect(text).not.toContain('[role="log"]')
  })

  it('removes orphaned legacy message-hide styles on recovery', () => {
    const fake = createFakeDocument()
    fake.seedLegacyHideStyle()
    fake.markColumn()
    recoverStaleTwitchSidebarChrome(fake.doc)
    expect(fake.hasStyle()).toBe(false)
  })

  it('clears chrome hides without leaving markers behind', () => {
    const fake = createFakeDocument()
    applyTwitchSidebarChromeHides(true, false, fake.doc)
    expect(fake.hasStyle()).toBe(true)
    applyTwitchSidebarChromeHides(false, false, fake.doc)
    expect(fake.hasStyle()).toBe(false)
  })
})
