import { createRoot, type Root } from 'react-dom/client'
import { Overlay } from '../ui/Overlay.tsx'
import type { PulsePayload } from '../shared/messages.ts'
import {
  getOverlayMode,
  getOverlayPlacement,
  getSidebarTab,
  type OverlayMode,
  type OverlayPlacement,
  type SidebarTab,
} from '../shared/storage.ts'
import { shadowStyles, theme } from '../ui/theme.ts'
import {
  observeChatSnapLayout,
  buildSidebarBodyRect,
  SIDEBAR_MINI_PANEL_HEIGHT,
  SIDEBAR_COLLAPSED_PILL_HEIGHT,
  type ChatRectSnapshot,
  type SidebarSnapLayout,
} from './twitchChat.ts'
import { applyTwitchSidebarChromeHides } from './twitchSidebarChrome.ts'
import type { TwitchPageContext } from './twitch.ts'
import { detectTwitchChannelLive } from './twitch.ts'

const TAB_HOST_ID = 'streamclone-pulse-tabs'
const PANEL_HOST_ID = 'streamclone-pulse-root'

export interface OverlayMountOptions {
  pendingTrackPrompt?: boolean
  onTrackStarted?: () => void
}

const BASE_STYLE = `
  :host {
    all: initial;
    font-family: ${theme.font};
    color: ${theme.textPrimary};
    pointer-events: none;
    position: fixed;
    z-index: 999999;
  }
  * { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; }
  .pulse-no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
  .pulse-no-scrollbar::-webkit-scrollbar { display: none; }
  .pulse-root { all: initial; pointer-events: none; width: 100%; height: 100%; }
  .pulse-shell {
    position: relative;
    pointer-events: auto;
    width: 100%;
    height: 100%;
    overflow: auto;
    background: ${theme.panelGlass};
    border: 1px solid ${theme.borderAccent};
    border-radius: ${theme.radiusPanel}px;
    box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    backdrop-filter: blur(14px);
    color: ${theme.textPrimary};
    font-family: ${theme.font};
    animation: pulse-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .placement-right {
    position: fixed;
    top: 50%;
    right: 12px;
    transform: translateY(-50%);
    width: min(392px, calc(100vw - 24px));
    max-height: min(82vh, 760px);
  }
  .placement-bottom {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    width: min(860px, calc(100vw - 32px));
    max-height: min(52vh, 560px);
  }
  .mode-mini.placement-right {
    top: auto;
    bottom: 88px;
    right: 12px;
    transform: none;
    width: min(420px, calc(100vw - 24px));
    max-height: 72px;
    overflow: hidden;
  }
  .mode-mini.placement-bottom {
    max-height: 72px;
    overflow: hidden;
  }
  .mode-collapsed.placement-right {
    top: auto;
    bottom: 24px;
    right: 12px;
    transform: none;
    width: auto;
    max-height: none;
    border-radius: 999px;
    overflow: visible;
  }
  .mode-collapsed.placement-bottom { bottom: 16px; }
  .pulse-hidden { display: none !important; }
  ${shadowStyles}
`

let tabsRoot: Root | null = null
let panelRoot: Root | null = null
let tabsHostEl: HTMLElement | null = null
let panelHostEl: HTMLElement | null = null
let currentLogin = ''
let currentContext: TwitchPageContext = { kind: 'non-channel', login: null, vodId: null }
let currentOptions: OverlayMountOptions = {}
let stopObserve: (() => void) | null = null
let sidebarLayout: SidebarSnapLayout | null = null
let storedPlacement: OverlayPlacement = 'sidebar'
let currentSidebarTab: SidebarTab = 'pulse'
let currentOverlayMode: OverlayMode = 'expanded'
let currentPayload: PulsePayload | null = null
let currentError: string | undefined

function createShadowHost(id: string): { host: HTMLElement; root: Root } {
  const host = document.createElement('div')
  host.id = id
  document.documentElement.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = BASE_STYLE
  shadow.appendChild(style)
  const mountPoint = document.createElement('div')
  mountPoint.className = 'pulse-root'
  shadow.appendChild(mountPoint)
  return { host, root: createRoot(mountPoint) }
}

function applyFixedRect(host: HTMLElement | null, rect: ChatRectSnapshot | null, visible: boolean): void {
  if (!host) return
  if (!visible || !rect || rect.width < 40 || rect.height < 8) {
    host.style.display = 'none'
    return
  }
  host.style.display = 'block'
  host.style.transform = 'none'
  host.style.top = `${rect.top}px`
  host.style.left = `${rect.left}px`
  host.style.width = `${rect.width}px`
  host.style.height = `${rect.height}px`
  host.style.right = 'auto'
  host.style.bottom = 'auto'
}

function applyFloatingHost(host: HTMLElement | null): void {
  if (!host) return
  host.style.display = 'block'
  host.style.top = ''
  host.style.left = ''
  host.style.width = ''
  host.style.height = ''
  host.style.transform = ''
}

function applySidebarLayout(): void {
  if (storedPlacement !== 'sidebar' || !sidebarLayout) {
    applyFixedRect(tabsHostEl, null, false)
    applyFixedRect(panelHostEl, null, false)
    applyTwitchSidebarChromeHides(false)
    return
  }

  applyTwitchSidebarChromeHides(true)
  applyFixedRect(tabsHostEl, sidebarLayout.header, true)

  const showPanel = currentSidebarTab === 'pulse'
  if (!showPanel) {
    applyFixedRect(panelHostEl, null, false)
    if (panelHostEl) panelHostEl.style.overflow = ''
    return
  }

  const bodyRect = buildSidebarBodyRect(sidebarLayout)

  if (currentOverlayMode === 'collapsed') {
    const collapsedRect: ChatRectSnapshot = {
      ...bodyRect,
      top: bodyRect.bottom - SIDEBAR_COLLAPSED_PILL_HEIGHT,
      height: SIDEBAR_COLLAPSED_PILL_HEIGHT,
      bottom: bodyRect.bottom,
    }
    applyFixedRect(panelHostEl, collapsedRect, true)
    if (panelHostEl) panelHostEl.style.overflow = 'visible'
    return
  }

  if (currentOverlayMode === 'mini') {
    const miniRect: ChatRectSnapshot = {
      ...bodyRect,
      top: bodyRect.bottom - SIDEBAR_MINI_PANEL_HEIGHT,
      height: SIDEBAR_MINI_PANEL_HEIGHT,
      bottom: bodyRect.bottom,
    }
    applyFixedRect(panelHostEl, miniRect, true)
    if (panelHostEl) panelHostEl.style.overflow = 'hidden'
    return
  }

  applyFixedRect(panelHostEl, bodyRect, true)
  if (panelHostEl) panelHostEl.style.overflow = 'hidden'
}

function renderOverlay(payload: PulsePayload | null, error?: string): void {
  const sidebarSnapped = storedPlacement === 'sidebar' && sidebarLayout !== null
  const effectivePlacement: OverlayPlacement = sidebarSnapped
    ? 'sidebar'
    : storedPlacement === 'sidebar'
      ? 'right'
      : storedPlacement

  const pageIsLive = detectTwitchChannelLive(currentContext)

  const sharedProps = {
    login: currentLogin,
    context: currentContext,
    payload,
    error,
    pageIsLive,
    pendingTrackPrompt: currentOptions.pendingTrackPrompt ?? false,
    onTrackStarted: currentOptions.onTrackStarted,
    effectivePlacement,
    sidebarSnapped,
    panelHostWidth: sidebarLayout?.panel.width ?? sidebarLayout?.column.width ?? 0,
    onSidebarTabChange: (tab: SidebarTab) => {
      currentSidebarTab = tab
      applySidebarLayout()
    },
    onOverlayModeChange: (mode: OverlayMode) => {
      currentOverlayMode = mode
      applySidebarLayout()
    },
  }

  if (sidebarSnapped) {
    tabsRoot?.render(<Overlay {...sharedProps} sidebarPart="tabs" />)
    panelRoot?.render(<Overlay {...sharedProps} sidebarPart="body" />)
    applySidebarLayout()
    return
  }

  applyFixedRect(tabsHostEl, null, false)
  applyFloatingHost(panelHostEl)
  panelRoot?.render(<Overlay {...sharedProps} sidebarPart="full" />)
}

function startSidebarObserver(): void {
  stopObserve?.()
  stopObserve = observeChatSnapLayout(next => {
    sidebarLayout = next
    applySidebarLayout()
    renderOverlay(currentPayload, currentError)
  })
}

export function mountOverlay(
  login: string,
  initial: PulsePayload | null,
  context: TwitchPageContext,
  options: OverlayMountOptions = {},
): void {
  currentLogin = login
  currentContext = context
  currentOptions = options
  currentPayload = initial
  currentError = undefined

  if (!tabsHostEl) {
    const tabs = createShadowHost(TAB_HOST_ID)
    tabsHostEl = tabs.host
    tabsRoot = tabs.root
  }
  if (!panelHostEl) {
    const panel = createShadowHost(PANEL_HOST_ID)
    panelHostEl = panel.host
    panelRoot = panel.root
  }

  void Promise.all([getOverlayPlacement(), getOverlayMode(), getSidebarTab()]).then(
    ([placement, mode, tab]) => {
      storedPlacement = placement
      currentOverlayMode = mode
      currentSidebarTab = tab
      if (storedPlacement === 'sidebar') {
        startSidebarObserver()
      } else {
        stopObserve?.()
        stopObserve = null
        sidebarLayout = null
      }
      renderOverlay(initial)
    },
  )
}

export function updateOverlayPayload(payload: PulsePayload | null, error?: string): void {
  if (!panelRoot || !currentLogin) return
  currentPayload = payload
  currentError = error
  renderOverlay(payload, error)
}

export function updateOverlayContext(context: TwitchPageContext): void {
  currentContext = context
  renderOverlay(currentPayload, currentError)
}

export function unmountOverlay(): void {
  stopObserve?.()
  stopObserve = null
  sidebarLayout = null
  applyTwitchSidebarChromeHides(false)
  tabsRoot?.unmount()
  panelRoot?.unmount()
  tabsRoot = null
  panelRoot = null
  tabsHostEl?.remove()
  panelHostEl?.remove()
  tabsHostEl = null
  panelHostEl = null
  currentLogin = ''
  currentOptions = {}
  currentPayload = null
  currentError = undefined
  currentSidebarTab = 'pulse'
  currentOverlayMode = 'expanded'
}

export function currentChannelLogin(): string {
  return currentLogin
}
