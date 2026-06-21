import { createRoot, type Root } from 'react-dom/client'
import { Overlay } from '../ui/Overlay.tsx'
import type { PulsePayload } from '../shared/messages.ts'

const HOST_ID = 'streamclone-pulse-root'
const STYLE = `
  :host {
    all: initial;
    font-family: Inter, system-ui, sans-serif;
    color: #f4f4f5;
  }
  .pulse-panel {
    position: fixed;
    top: 72px;
    right: 16px;
    z-index: 999999;
    width: 320px;
    max-height: 70vh;
    overflow: auto;
    background: rgba(15, 15, 18, 0.94);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.45);
    padding: 12px 14px;
  }
`

let root: Root | null = null
let hostEl: HTMLElement | null = null
let currentLogin = ''

export function mountOverlay(login: string, initial: PulsePayload | null): void {
  currentLogin = login
  if (!hostEl) {
    hostEl = document.createElement('div')
    hostEl.id = HOST_ID
    document.documentElement.appendChild(hostEl)
    const shadow = hostEl.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLE
    shadow.appendChild(style)
    const mountPoint = document.createElement('div')
    mountPoint.className = 'pulse-panel'
    shadow.appendChild(mountPoint)
    root = createRoot(mountPoint)
  }
  root?.render(<Overlay login={login} payload={initial} />)
}

export function updateOverlayPayload(payload: PulsePayload | null, error?: string): void {
  if (!root || !currentLogin) return
  root.render(<Overlay login={currentLogin} payload={payload} error={error} />)
}

export function unmountOverlay(): void {
  root?.unmount()
  root = null
  hostEl?.remove()
  hostEl = null
  currentLogin = ''
}

export function currentChannelLogin(): string {
  return currentLogin
}
