import { createRoot, type Root } from 'react-dom/client'
import { Overlay } from '../ui/Overlay.tsx'
import type { ExtensionCoverageTierResponse, PulsePayload } from '../shared/messages.ts'
import {
  DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED,
  DEFAULT_OVERLAY_MODE,
  DEFAULT_OVERLAY_PLACEMENT,
  DEFAULT_SIDEBAR_TAB,
  getOverlayMode,
  getOverlayPlacement,
  getSidebarTab,
  getChatClosedPulseDockEnabled,
  getThemePreference,
  CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY,
  THEME_PREFERENCE_KEY,
  type OverlayMode,
  type OverlayPlacement,
  type SidebarTab,
  type ThemePreference,
} from '../shared/storage.ts'
import { applyAccentTheme } from '../ui/overlayTheme.ts'
import { shadowStyles, theme } from '../ui/theme.ts'
import {
  observeChatSnapLayout,
  buildSidebarBodyRect,
  SIDEBAR_MINI_PANEL_HEIGHT,
  SIDEBAR_COLLAPSED_PILL_HEIGHT,
  type ChatRectSnapshot,
  type SidebarSnapLayout,
} from './twitchChat.ts'
import {
  resolveOverlayHostVisibility,
  SIDEBAR_FLOAT_FALLBACK_MS,
  type OverlayHostVisibility,
} from './resolveOverlayHostVisibility.ts'
import { applyTwitchSidebarChromeHides } from './twitchSidebarChrome.ts'
import type { TwitchPageContext } from './twitch.ts'
import { detectTwitchChannelLive } from './twitch.ts'

const TAB_HOST_ID = 'streamclone-pulse-tabs'
const PANEL_HOST_ID = 'streamclone-pulse-root'

let themeListenerInstalled = false

function installThemeSyncListener(): void {
  if (themeListenerInstalled) return
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return
  themeListenerInstalled = true
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[THEME_PREFERENCE_KEY]) return
    const next = changes[THEME_PREFERENCE_KEY].newValue
    if (next === 'aurora' || next === 'volt' || next === 'azure') {
      applyAccentTheme(next as ThemePreference)
    }
  })
}

export interface OverlayMountOptions {
  pendingTrackPrompt?: boolean
  onTrackStarted?: () => void
  sessionOpenedAtMs?: number | null
  coverageTier?: ExtensionCoverageTierResponse | null
}

const BASE_STYLE = `
  :host {
    display: block;
    font-family: ${theme.font};
    color: ${theme.textPrimary};
    pointer-events: none;
    position: fixed;
    z-index: 2147483000;
    isolation: isolate;
    box-sizing: border-box;
  }
  * { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; }
  button:focus, button:focus-visible { outline: none !important; }
  .pulse-no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
  .pulse-no-scrollbar::-webkit-scrollbar { display: none; }
  .pulse-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    pointer-events: none;
    font-family: ${theme.font};
    color: ${theme.textPrimary};
  }
  .pulse-shell {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    pointer-events: auto;
    width: 100%;
    min-height: 0;
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
    height: auto;
    flex: 0 0 auto;
  }
  .placement-bottom {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    width: min(860px, calc(100vw - 32px));
    max-height: min(52vh, 560px);
    height: auto;
    flex: 0 0 auto;
  }
  .placement-sidebar.pulse-shell {
    height: 100%;
    min-height: 100%;
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
  .pulse-sidebar-panel.pulse-shell {
    background: ${theme.bgCanvas};
    border: 0;
    border-radius: 0;
    box-shadow: none;
    backdrop-filter: none;
  }
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
let storedPlacement: OverlayPlacement = DEFAULT_OVERLAY_PLACEMENT
let placementResolved = false
let sidebarFallbackToFloat = false
let sidebarFallbackTimer: ReturnType<typeof setTimeout> | null = null
let chatClosedPulseDockEnabled = false
let mountStorageListenerInstalled = false
let currentSidebarTab: SidebarTab = 'pulse'
let currentOverlayMode: OverlayMode = 'expanded'
let currentPayload: PulsePayload | null = null
let currentError: string | undefined
let currentCoverageTier: ExtensionCoverageTierResponse | null = null

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
  host.style.overflow = 'hidden'
}

function applyFloatingHost(host: HTMLElement | null): void {
  if (!host) return
  host.style.display = 'block'
  host.style.top = ''
  host.style.left = ''
  host.style.width = ''
  host.style.height = ''
  host.style.transform = ''
  host.style.overflow = ''
}

function clearSidebarFallbackTimer(): void {
  if (sidebarFallbackTimer != null) {
    window.clearTimeout(sidebarFallbackTimer)
    sidebarFallbackTimer = null
  }
}

function resetSidebarFallback(): void {
  clearSidebarFallbackTimer()
  sidebarFallbackToFloat = false
}

function scheduleSidebarFallback(): void {
  if (!chatClosedPulseDockEnabled || storedPlacement !== 'sidebar' || sidebarLayout != null || sidebarFallbackToFloat) return
  clearSidebarFallbackTimer()
  sidebarFallbackTimer = window.setTimeout(() => {
    sidebarFallbackTimer = null
    if (storedPlacement === 'sidebar' && sidebarLayout == null) {
      sidebarFallbackToFloat = true
      renderOverlay(currentPayload, currentError)
    }
  }, SIDEBAR_FLOAT_FALLBACK_MS)
}

function applySidebarSnapLayout(): void {
  if (!sidebarLayout) return

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

function applyHostVisibility(visibility: OverlayHostVisibility): void {
  if (visibility.mode === 'sidebar') {
    applySidebarSnapLayout()
    return
  }

  applyTwitchSidebarChromeHides(false)
  applyFixedRect(tabsHostEl, null, false)

  if (visibility.mode === 'floating') {
    applyFloatingHost(panelHostEl)
    return
  }

  applyFixedRect(tabsHostEl, null, false)
  applyFixedRect(panelHostEl, null, false)
  if (panelHostEl) panelHostEl.style.overflow = ''
}

function currentHostVisibility(): OverlayHostVisibility {
  return resolveOverlayHostVisibility({
    storedPlacement,
    sidebarLayoutPresent: sidebarLayout !== null,
    sidebarFallbackToFloat,
    placementResolved,
    chatClosedPulseDockEnabled,
  })
}

function syncSidebarObserver(): void {
  if (!placementResolved || storedPlacement !== 'sidebar') {
    stopObserve?.()
    stopObserve = null
    if (storedPlacement !== 'sidebar') {
      sidebarLayout = null
      resetSidebarFallback()
    }
    return
  }
  startSidebarObserver()
}

function installMountStorageListener(): void {
  if (mountStorageListenerInstalled) return
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return
  mountStorageListenerInstalled = true
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return
    if (changes.overlayPlacement || changes[CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY]) {
      void Promise.all([getOverlayPlacement(), getChatClosedPulseDockEnabled()]).then(([placement, dockEnabled]) => {
        storedPlacement = placement
        chatClosedPulseDockEnabled = dockEnabled
        if (!dockEnabled) {
          resetSidebarFallback()
        }
        syncSidebarObserver()
        renderOverlay(currentPayload, currentError)
      })
    }
  })
}

function renderOverlay(payload: PulsePayload | null, error?: string): void {
  const visibility = currentHostVisibility()
  const { effectivePlacement, sidebarSnapped } = visibility

  const pageIsLive = detectTwitchChannelLive(currentContext)

  const sharedProps = {
    login: currentLogin,
    context: currentContext,
    payload,
    error,
    pageIsLive,
    pendingTrackPrompt: currentOptions.pendingTrackPrompt ?? false,
    onTrackStarted: currentOptions.onTrackStarted,
    sessionOpenedAtMs: currentOptions.sessionOpenedAtMs ?? null,
    coverageTier: currentCoverageTier,
    effectivePlacement,
    sidebarSnapped,
    panelHostWidth: sidebarLayout?.panel.width ?? sidebarLayout?.column.width ?? 0,
    sidebarTab: currentSidebarTab,
    overlayMode: currentOverlayMode,
    onSidebarTabChange: (tab: SidebarTab) => {
      currentSidebarTab = tab
      renderOverlay(currentPayload, currentError)
    },
    onOverlayModeChange: (mode: OverlayMode) => {
      currentOverlayMode = mode
      renderOverlay(currentPayload, currentError)
    },
  }

  if (sidebarSnapped) {
    tabsRoot?.render(<Overlay {...sharedProps} sidebarPart="tabs" />)
    panelRoot?.render(<Overlay {...sharedProps} sidebarPart="body" />)
  } else {
    tabsRoot?.render(null)
    panelRoot?.render(<Overlay {...sharedProps} sidebarPart="full" />)
  }

  applyHostVisibility(visibility)

  if (placementResolved && chatClosedPulseDockEnabled && storedPlacement === 'sidebar' && sidebarLayout == null) {
    scheduleSidebarFallback()
  } else if (sidebarLayout != null || !chatClosedPulseDockEnabled) {
    resetSidebarFallback()
  }
}

function startSidebarObserver(): void {
  stopObserve?.()
  stopObserve = observeChatSnapLayout(next => {
    sidebarLayout = next
    if (next != null) resetSidebarFallback()
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
  currentCoverageTier = options.coverageTier ?? null
  storedPlacement = DEFAULT_OVERLAY_PLACEMENT
  currentOverlayMode = DEFAULT_OVERLAY_MODE
  currentSidebarTab = DEFAULT_SIDEBAR_TAB
  chatClosedPulseDockEnabled = DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED
  placementResolved = true
  resetSidebarFallback()

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

  installThemeSyncListener()
  installMountStorageListener()
  void getThemePreference().then(pref => applyAccentTheme(pref))
  syncSidebarObserver()
  renderOverlay(currentPayload, currentError)

  void Promise.all([
    getOverlayPlacement(),
    getOverlayMode(),
    getSidebarTab(),
    getThemePreference(),
    getChatClosedPulseDockEnabled(),
  ]).then(([placement, mode, tab, themePref, dockEnabled]) => {
      applyAccentTheme(themePref)
      const placementChanged = placement !== storedPlacement
      const dockChanged = dockEnabled !== chatClosedPulseDockEnabled
      storedPlacement = placement
      currentOverlayMode = mode
      currentSidebarTab = tab
      chatClosedPulseDockEnabled = dockEnabled
      if (!dockEnabled) {
        resetSidebarFallback()
      }
      if (placementChanged || dockChanged) {
        syncSidebarObserver()
      }
      renderOverlay(currentPayload, currentError)
    },
  )
}

export function updateOverlayPayload(
  payload: PulsePayload | null,
  error?: string,
  coverageTier?: ExtensionCoverageTierResponse | null,
): void {
  if (!panelRoot || !currentLogin) return
  currentPayload = payload
  currentError = error
  if (coverageTier !== undefined) {
    currentCoverageTier = coverageTier
  }
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
  placementResolved = false
  chatClosedPulseDockEnabled = false
  resetSidebarFallback()
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
  currentCoverageTier = null
  currentSidebarTab = 'pulse'
  currentOverlayMode = 'expanded'
}

export function currentChannelLogin(): string {
  return currentLogin
}
