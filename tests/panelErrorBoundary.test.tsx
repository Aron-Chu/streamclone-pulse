// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXTENSION_DIAGNOSTICS_INGEST_ENABLED } from '../src/shared/diagnosticsConsent.ts'
import { PanelErrorBoundary } from '../src/ui/PanelErrorBoundary.tsx'

const emit = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../src/shared/extensionDiagnostics.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/shared/extensionDiagnostics.ts')>()),
  emitExtensionDiagnostic: emit,
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Crash(): never {
  throw new TypeError('boom')
}

describe('PanelErrorBoundary', () => {
  let node: HTMLDivElement
  let root: Root
  let sendMessage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sendMessage = vi.fn(async () => undefined)
    vi.stubGlobal('chrome', { runtime: { id: 'test', sendMessage } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    node = document.createElement('div')
    document.body.appendChild(node)
    root = createRoot(node)
  })

  afterEach(() => {
    act(() => root.unmount())
    node.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('builds no diagnostics report while upload is compiled off, and still shows the error copy', async () => {
    expect(EXTENSION_DIAGNOSTICS_INGEST_ENABLED).toBe(false)
    await act(async () => {
      root.render(<PanelErrorBoundary><Crash /></PanelErrorBoundary>)
    })
    expect(node.textContent).toContain('Something went wrong rendering this panel.')
    expect(emit).not.toHaveBeenCalled()
    // The coarse error-shown event still goes to the worker, which applies consent.
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'EMIT_EXTENSION_ANALYTICS' }))
  })
})
