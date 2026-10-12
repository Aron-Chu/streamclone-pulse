// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { eventPathIncludesNode, onOutsidePointerDown } from '../src/ui/pulsePortalContext.ts'

function press(target: Element) {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))
}

afterEach(() => document.body.replaceChildren())

describe('onOutsidePointerDown', () => {
  // Store builds attach a closed root. From the document, every press inside
  // it looks like a press on the host, so it must be classified in the root.
  it('sees presses inside a closed shadow root as inside', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'closed' })
    const boundary = document.createElement('div')
    const inner = document.createElement('button')
    const elsewhere = document.createElement('button')
    boundary.append(inner)
    shadow.append(boundary, elsewhere)
    const outside = vi.fn()
    const stop = onOutsidePointerDown(shadow, event => eventPathIncludesNode(event, boundary), outside)

    press(inner)
    expect(outside).not.toHaveBeenCalled()
    press(elsewhere)
    expect(outside).toHaveBeenCalledTimes(1)
    press(document.body)
    expect(outside).toHaveBeenCalledTimes(2)

    stop()
    press(elsewhere)
    expect(outside).toHaveBeenCalledTimes(2)
  })

  it('works without a shadow root (the portal renders into the document)', () => {
    const boundary = document.createElement('div')
    const inner = document.createElement('span')
    boundary.append(inner)
    document.body.append(boundary)
    const outside = vi.fn()
    const stop = onOutsidePointerDown(document, event => eventPathIncludesNode(event, boundary), outside)
    press(inner)
    expect(outside).not.toHaveBeenCalled()
    press(document.body)
    expect(outside).toHaveBeenCalledTimes(1)
    stop()
  })
})
