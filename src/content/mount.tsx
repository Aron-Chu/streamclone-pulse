import { createRoot, type Root } from 'react-dom/client'
import { Overlay, type SidebarTabChangeSource } from '../ui/Overlay.tsx'
import { mergePulsePayload } from '../background/pulsePayloadMerge.ts'
import { resolveOverlayErrorState } from '../shared/pulseError.ts'
import type { ExtensionCoverageTierResponse, PulsePayload, PulseUpdateMessage } from '../shared/messages.ts'
import type { ExtensionVodPulseResponse } from '../types/vodPulseTypes.ts'
import type { PulseCacheWindow } from '../shared/storage.ts'
import {
  DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED,
  DEFAULT_OVERLAY_MODE,
  DEFAULT_OVERLAY_PLACEMENT,
  DEFAULT_SIDEBAR_TAB,
  getOverlayDisplayPreferences,
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
import { PulsePortalContext } from '../ui/pulsePortalContext.ts'
import { shadowStyles, theme } from '../ui/theme.ts'
import {
  observeChatSnapLayout,
  buildSidebarBodyRect,
  focusNativeChatComposer,
  SIDEBAR_MINI_PANEL_HEIGHT,
  SIDEBAR_COLLAPSED_PILL_HEIGHT,
  resolveChatDockBottomY,
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
import { installContentDiagnosticsEmitters } from '../shared/extensionDiagnostics.ts'

const TAB_HOST_ID = 'streamclone-pulse-tabs'
const PANEL_HOST_ID = 'streamclone-pulse-root'

export const PULSE_TABS_HOST_ID = TAB_HOST_ID
export const PULSE_ROOT_HOST_ID = PANEL_HOST_ID

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
  onPulseRefresh?: () => Promise<void>
  onLivePollWindowChange?: (window: PulseCacheWindow) => void
  softStaleRefreshWarning?: boolean
}

export function applyOverlayPayloadUpdate(
  previous: PulsePayload | null,
  incoming: PulsePayload | null,
  options?: { allowStreamChange?: boolean },
): PulsePayload | null {
  if (!incoming) return previous
  const previousStreamId = previous?.streamId?.trim() ?? ''
  const incomingStreamId = incoming.streamId?.trim() ?? ''
  if (previousStreamId && (!incomingStreamId || previousStreamId !== incomingStreamId)) {
    return options?.allowStreamChange ? incoming : previous
  }
  return previous ? mergePulsePayload(previous, incoming) : incoming
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
  /* Keep mouse focus quiet while preserving the browser keyboard indicator. */
  button:focus:not(:focus-visible), input:focus:not(:focus-visible),
  select:focus:not(:focus-visible), textarea:focus:not(:focus-visible) { outline: none; }
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
let tabsShadowRoot: ShadowRoot | null = null
let panelShadowRoot: ShadowRoot | null = null
let lastTabsRenderKey = ''
let lastPanelPayloadRef: PulsePayload | null | undefined = undefined
let lastPanelError: string | undefined
let lastPanelCoverageTier: ExtensionCoverageTierResponse | null | undefined = undefined
let currentLogin = ''
let currentContext: TwitchPageContext = { kind: 'non-channel', login: null, vodId: null }
let currentVodPulse: ExtensionVodPulseResponse | null = null
let currentVodPulseLoading = false
let currentOptions: OverlayMountOptions = {}
let stopObserve: (() => void) | null = null
let sidebarLayout: SidebarSnapLayout | null = null
let storedPlacement: OverlayPlacement = DEFAULT_OVERLAY_PLACEMENT
let placementResolved = false
let sidebarFallbackToFloat = false
let sidebarFallbackTimer: ReturnType<typeof setTimeout> | null = null
let chatClosedPulseDockEnabled = false
let mountStorageListenerInstalled = false
let overlayDiagnosticsInstalled = false
let overlayHostObserver: MutationObserver | null = null
let overlayHostReconcileTimer: ReturnType<typeof setTimeout> | null = null
let chatFocusFrameOne: number | null = null
let chatFocusFrameTwo: number | null = null

function installOverlayDiagnosticsOnce(): void {
  if (overlayDiagnosticsInstalled) return
  overlayDiagnosticsInstalled = true
  installContentDiagnosticsEmitters({ feature: 'overlay' })
}

function cancelChatFocusSchedule(): void {
  if (chatFocusFrameOne != null) window.cancelAnimationFrame(chatFocusFrameOne)
  if (chatFocusFrameTwo != null) window.cancelAnimationFrame(chatFocusFrameTwo)
  chatFocusFrameOne = null
  chatFocusFrameTwo = null
}

/** Tell chart/rail surfaces to release pointer capture before Chat owns the body. */
function cancelPulseInteractions(): void {
  cancelChatFocusSchedule()
  document.dispatchEvent(new CustomEvent('streampulse:deactivate-interactions'))
  const activeElements = [
    tabsShadowRoot?.activeElement,
    panelShadowRoot?.activeElement,
    document.activeElement,
  ]
  for (const element of activeElements) {
    if (element instanceof HTMLElement) element.blur()
  }
}

function scheduleNativeChatFocus(): void {
  cancelChatFocusSchedule()
  if (typeof window.requestAnimationFrame !== 'function') {
    window.setTimeout(() => {
      if (currentSidebarTab === 'chat' && sidebarLayout) focusNativeChatComposer()
    }, 0)
    return
  }
  chatFocusFrameOne = window.requestAnimationFrame(() => {
    chatFocusFrameOne = null
    chatFocusFrameTwo = window.requestAnimationFrame(() => {
      chatFocusFrameTwo = null
      if (currentSidebarTab === 'chat' && sidebarLayout) focusNativeChatComposer()
    })
  })
}

let currentSidebarTab: SidebarTab = 'pulse'
let currentOverlayMode: OverlayMode = 'expanded'
let currentPayload: PulsePayload | null = null
let currentError: string | undefined
let currentCoverageTier: ExtensionCoverageTierResponse | null = null
let displayPreferenceRequestId = 0

function purgeExtraHosts(id: string, keep: HTMLElement | null): void {
  // Do not use `#id` selectors — browsers may collapse duplicate IDs to one match.
  const doomed: HTMLElement[] = []
  for (const node of document.querySelectorAll('*')) {
    if (!(node instanceof HTMLElement) || node.id !== id) continue
    if (keep && node === keep && keep.isConnected) continue
    doomed.push(node)
  }
  for (const node of doomed) node.remove()
}

function containsOverlayHost(node: Node): boolean {
  if (!(node instanceof Element)) return false
  if (node.id === TAB_HOST_ID || node.id === PANEL_HOST_ID) return true
  for (const descendant of node.querySelectorAll('*')) {
    if (descendant.id === TAB_HOST_ID || descendant.id === PANEL_HOST_ID) return true
  }
  return false
}

function reconcileOverlayHosts(): void {
  if (!tabsHostEl?.isConnected) {
    stopObserve?.()
    stopObserve = null
    tabsRoot?.unmount()
    tabsRoot = null
    tabsHostEl = null
    tabsShadowRoot = null
  }
  if (!panelHostEl?.isConnected) {
    panelRoot?.unmount()
    panelRoot = null
    panelHostEl = null
    panelShadowRoot = null
  }
  purgeExtraHosts(TAB_HOST_ID, tabsHostEl)
  purgeExtraHosts(PANEL_HOST_ID, panelHostEl)
}

/** Public: drop orphan duplicate hosts without resetting overlay payload. */
export function ensureUniqueOverlayHosts(): void {
  reconcileOverlayHosts()
}

function installOverlayHostObserver(): void {
  if (overlayHostObserver || typeof MutationObserver === 'undefined' || !document.documentElement) return
  overlayHostObserver = new MutationObserver(mutations => {
    // Twitch and extension reinjection can append a second host without changing
    // the route. Reconcile that mutation immediately instead of waiting for the
    // debounced route scheduler, while ignoring normal chat/page churn.
    if (!mutations.some(mutation => Array.from(mutation.addedNodes).some(containsOverlayHost))) return
    if (overlayHostReconcileTimer != null) return
    overlayHostReconcileTimer = setTimeout(() => {
      overlayHostReconcileTimer = null
      reconcileOverlayHosts()
    }, 50)
  })
  overlayHostObserver.observe(document.documentElement, { childList: true, subtree: true })
}

function createShadowHost(id: string): { host: HTMLElement; shadow: ShadowRoot; root: Root } {
  const host = document.createElement('div')
  host.id = id
  document.documentElement.appendChild(host)
  // Development builds keep the existing inspection hook for mocked E2E tests.
  // Store targets use a closed root so Twitch page scripts cannot inspect controls.
  const shadow = host.attachShadow({ mode: __EXTENSION_STORE_BUILD__ ? 'closed' : 'open' })
  const style = document.createElement('style')
  style.textContent = BASE_STYLE
  shadow.appendChild(style)
  const mountPoint = document.createElement('div')
  mountPoint.className = 'pulse-root'
  shadow.appendChild(mountPoint)
  return { host, shadow, root: createRoot(mountPoint) }
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

function buildDockHostRect(
  bodyRect: ChatRectSnapshot,
  column: ChatRectSnapshot,
  dockHeight: number,
): ChatRectSnapshot {
  const dockBottom = resolveChatDockBottomY(document, bodyRect.bottom, column)
  const top = Math.max(bodyRect.top, dockBottom - dockHeight)
  return {
    ...bodyRect,
    top,
    height: Math.max(28, dockBottom - top),
    bottom: dockBottom,
  }
}

function applySidebarSnapLayout(): void {
  if (!sidebarLayout) return

  const pulseTabActive = currentSidebarTab === 'pulse'
  // Pulse owns the body, so hide Twitch's native message chrome while it is
  // active. Chat owns the body, so remove the style entirely and restore all
  // native banners/messages when the user switches back.
  applyTwitchSidebarChromeHides(pulseTabActive, pulseTabActive)
  applyFixedRect(tabsHostEl, sidebarLayout.header, true)

  const showPanel = pulseTabActive
  if (!showPanel) {
    applyFixedRect(panelHostEl, null, false)
    if (panelHostEl) {
      panelHostEl.style.overflow = ''
      panelHostEl.setAttribute('aria-hidden', 'true')
      ;(panelHostEl as HTMLElement & { inert?: boolean }).inert = true
    }
    return
  }

  if (panelHostEl) {
    panelHostEl.removeAttribute('aria-hidden')
    ;(panelHostEl as HTMLElement & { inert?: boolean }).inert = false
  }

  const bodyRect = buildSidebarBodyRect(sidebarLayout)

  if (currentOverlayMode === 'collapsed') {
    const collapsedRect = buildDockHostRect(
      bodyRect,
      sidebarLayout.column,
      SIDEBAR_COLLAPSED_PILL_HEIGHT,
    )
    applyFixedRect(panelHostEl, collapsedRect, true)
    if (panelHostEl) panelHostEl.style.overflow = 'visible'
    return
  }

  if (currentOverlayMode === 'mini') {
    const miniRect = buildDockHostRect(bodyRect, sidebarLayout.column, SIDEBAR_MINI_PANEL_HEIGHT)
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
    panelHostEl?.removeAttribute('aria-hidden')
    if (panelHostEl) {
      (panelHostEl as HTMLElement & { inert?: boolean }).inert = false
    }
    return
  }

  applyFixedRect(tabsHostEl, null, false)
  applyFixedRect(panelHostEl, null, false)
  panelHostEl?.removeAttribute('aria-hidden')
  if (panelHostEl) {
    (panelHostEl as HTMLElement & { inert?: boolean }).inert = false
  }
  if (panelHostEl) panelHostEl.style.overflow = ''
}

function currentHostVisibility(): OverlayHostVisibility {
  return resolveOverlayHostVisibility({
    storedPlacement,
    sidebarLayoutPresent: sidebarLayout !== null,
    sidebarFallbackToFloat,
    placementResolved,
    chatClosedPulseDockEnabled,
    sidebarTab: currentSidebarTab,
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
    if (changes.overlayPlacement || changes.overlayMode || changes[CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY]) {
      // Initial hydration performs a coherent read after legacy migrations. Let it
      // finish instead of allowing the migration's own storage event to cancel it.
      if (!placementResolved) return
      const requestId = ++displayPreferenceRequestId
      void Promise.all([getOverlayDisplayPreferences(), getChatClosedPulseDockEnabled()]).then(([display, dockEnabled]) => {
        if (requestId !== displayPreferenceRequestId) return
        storedPlacement = display.placement
        currentOverlayMode = display.mode
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
    onSidebarTabChange: (tab: SidebarTab, source: SidebarTabChangeSource = 'sync') => {
      if (tab !== currentSidebarTab || source === 'user') cancelPulseInteractions()
      currentSidebarTab = tab
      renderOverlay(currentPayload, currentError)
      if (tab === 'chat' && source === 'user') scheduleNativeChatFocus()
    },
    onOverlayModeChange: (mode: OverlayMode) => {
      currentOverlayMode = mode
      renderOverlay(currentPayload, currentError)
    },
    onPulseRefresh: currentOptions.onPulseRefresh,
    onPulsePayloadUpdate: (message: PulseUpdateMessage) => {
      updateOverlayPayload(message.payload, message.error, message.coverageTier ?? null, { authoritative: true })
    },
    onLivePollWindowChange: currentOptions.onLivePollWindowChange,
    softStaleRefreshWarning: currentOptions.softStaleRefreshWarning ?? false,
    vodPulse: currentVodPulse,
    vodPulseLoading: currentVodPulseLoading,
  }

  if (sidebarSnapped) {
    const tabsKey = [
      effectivePlacement,
      currentSidebarTab,
      currentOverlayMode,
      sidebarSnapped ? '1' : '0',
    ].join('|')
    if (tabsKey !== lastTabsRenderKey) {
      lastTabsRenderKey = tabsKey
      tabsRoot?.render(
        <PulsePortalContext.Provider value={tabsShadowRoot}>
          <Overlay
            login={currentLogin}
            context={currentContext}
            payload={null}
            effectivePlacement={effectivePlacement}
            sidebarSnapped
            sidebarPart="tabs"
            sidebarTab={currentSidebarTab}
            overlayMode={currentOverlayMode}
            onSidebarTabChange={sharedProps.onSidebarTabChange}
            onOverlayModeChange={sharedProps.onOverlayModeChange}
          />
        </PulsePortalContext.Provider>,
      )
    }
    panelRoot?.render(
      <PulsePortalContext.Provider value={panelShadowRoot}>
        <Overlay {...sharedProps} sidebarPart="body" />
      </PulsePortalContext.Provider>,
    )
  } else {
    lastTabsRenderKey = ''
    tabsRoot?.render(null)
    panelRoot?.render(
      <PulsePortalContext.Provider value={panelShadowRoot}>
        <Overlay {...sharedProps} sidebarPart="full" />
      </PulsePortalContext.Provider>,
    )
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
  reconcileOverlayHosts()
  const needsDisplayHydration = !tabsHostEl || !panelHostEl
  currentLogin = login
  currentContext = context
  currentOptions = options
  currentPayload = initial
  currentError = undefined
  currentCoverageTier = options.coverageTier ?? null
  if (needsDisplayHydration) {
    storedPlacement = DEFAULT_OVERLAY_PLACEMENT
    currentOverlayMode = DEFAULT_OVERLAY_MODE
    currentSidebarTab = DEFAULT_SIDEBAR_TAB
    chatClosedPulseDockEnabled = DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED
    placementResolved = false
    resetSidebarFallback()
  }

  if (!tabsHostEl) {
    const tabs = createShadowHost(TAB_HOST_ID)
    tabsHostEl = tabs.host
    tabsShadowRoot = tabs.shadow
    tabsRoot = tabs.root
  }
  if (!panelHostEl) {
    const panel = createShadowHost(PANEL_HOST_ID)
    panelHostEl = panel.host
    panelShadowRoot = panel.shadow
    panelRoot = panel.root
  }
  installOverlayHostObserver()

  installThemeSyncListener()
  installMountStorageListener()
  installOverlayDiagnosticsOnce()
  void getThemePreference().then(pref => applyAccentTheme(pref))
  syncSidebarObserver()
  renderOverlay(currentPayload, currentError)

  if (!needsDisplayHydration) return

  const requestId = ++displayPreferenceRequestId
  void Promise.all([
    getOverlayDisplayPreferences(),
    getSidebarTab(),
    getThemePreference(),
    getChatClosedPulseDockEnabled(),
  ]).then(([display, tab, themePref, dockEnabled]) => {
      if (requestId !== displayPreferenceRequestId || !panelRoot) return
      applyAccentTheme(themePref)
      storedPlacement = display.placement
      currentOverlayMode = display.mode
      currentSidebarTab = tab
      chatClosedPulseDockEnabled = dockEnabled
      placementResolved = true
      if (!dockEnabled) {
        resetSidebarFallback()
      }
      syncSidebarObserver()
      renderOverlay(currentPayload, currentError)
    },
  )
}

export function updateOverlayPayload(
  payload: PulsePayload | null,
  error?: string,
  coverageTier?: ExtensionCoverageTierResponse | null,
  meta?: { softStaleRefresh?: boolean; authoritative?: boolean },
): void {
  if (!panelRoot || !currentLogin) return
  const previousPayload = currentPayload
  if (meta?.softStaleRefresh) {
    // Keep cached chart; surface a bounded nonblocking warning via options/error lane.
    currentError = undefined
    currentOptions = {
      ...currentOptions,
      softStaleRefreshWarning: true,
    }
    lastPanelPayloadRef = currentPayload
    lastPanelError = currentError
    lastPanelCoverageTier = currentCoverageTier
    renderOverlay(currentPayload, currentError)
    return
  }
  if (payload) {
    const nextPayload = applyOverlayPayloadUpdate(currentPayload, payload, {
      allowStreamChange: meta?.authoritative,
    })
    const streamMismatch = Boolean(
      currentPayload?.streamId
      && nextPayload === currentPayload
      && currentPayload.streamId !== payload.streamId,
    )
    if (streamMismatch) return
    currentPayload = nextPayload
    currentOptions = { ...currentOptions, softStaleRefreshWarning: false }
  }
  currentError = resolveOverlayErrorState(currentError, payload, error)
  if (coverageTier !== undefined) {
    currentCoverageTier = coverageTier
  }
  // Identical poll after merge: skip React work (tabs shell never needed chart payloads).
  if (
    currentPayload === previousPayload
    && currentPayload === lastPanelPayloadRef
    && currentError === lastPanelError
    && currentCoverageTier === lastPanelCoverageTier
  ) {
    return
  }
  lastPanelPayloadRef = currentPayload
  lastPanelError = currentError
  lastPanelCoverageTier = currentCoverageTier
  renderOverlay(currentPayload, currentError)
}

export function updateOverlayContext(context: TwitchPageContext): void {
  currentContext = context
  renderOverlay(currentPayload, currentError)
}

export function updateOverlayLogin(login: string): void {
  if (!login || login === currentLogin) return
  currentLogin = login
  renderOverlay(currentPayload, currentError)
}

export function updateOverlayVodState(input: {
  vodPulse?: ExtensionVodPulseResponse | null
  loading?: boolean
}): void {
  if (input.vodPulse !== undefined) {
    currentVodPulse = input.vodPulse
  }
  if (input.loading !== undefined) {
    currentVodPulseLoading = input.loading
  }
  renderOverlay(currentPayload, currentError)
}

export function unmountOverlay(): void {
  displayPreferenceRequestId += 1
  overlayHostObserver?.disconnect()
  overlayHostObserver = null
  if (overlayHostReconcileTimer != null) {
    clearTimeout(overlayHostReconcileTimer)
    overlayHostReconcileTimer = null
  }
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
  tabsShadowRoot = null
  panelShadowRoot = null
  purgeExtraHosts(TAB_HOST_ID, null)
  purgeExtraHosts(PANEL_HOST_ID, null)
  lastTabsRenderKey = ''
  lastPanelPayloadRef = undefined
  lastPanelError = undefined
  lastPanelCoverageTier = undefined
  currentLogin = ''
  currentVodPulse = null
  currentVodPulseLoading = false
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
