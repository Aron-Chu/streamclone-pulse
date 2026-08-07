import { createRoot, type Root } from 'react-dom/client'
import { Overlay } from '../ui/Overlay.tsx'
import { PulsePortalContext } from '../ui/pulsePortalContext.ts'
import { mergePulsePayload } from '../background/pulsePayloadMerge.ts'
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
  getColorSchemePreference,
  CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY,
  THEME_PREFERENCE_KEY,
  COLOR_SCHEME_PREFERENCE_KEY,
  type OverlayMode,
  type OverlayPlacement,
  type SidebarTab,
  type ThemePreference,
  type ColorSchemePreference,
} from '../shared/storage.ts'
import { applyAccentTheme, applyAccentRolesToHost } from '../ui/overlayTheme.ts'
import { applySurfaceThemeToHost } from '../ui/surfaceTheme.ts'
import { shadowStyles, theme } from '../ui/theme.ts'
import { resolveOverlayErrorState } from '../shared/pulseError.ts'
import {
  detectTwitchColorScheme,
  observeTwitchColorScheme,
  resolvePulseColorScheme,
  type TwitchColorScheme,
} from './twitchTheme.ts'
import {
  observeChatSnapLayout,
  buildSidebarBodyRect,
  shouldRerenderOverlayForSnapChange,
  type ChatRectSnapshot,
  type SidebarSnapLayout,
} from './twitchChat.ts'
import {
  resolveOverlayHostVisibility,
  SIDEBAR_FLOAT_FALLBACK_MS,
  type OverlayHostVisibility,
} from './resolveOverlayHostVisibility.ts'
import {
  applyTwitchSidebarChromeHides,
  recoverStaleTwitchSidebarChrome,
} from './twitchSidebarChrome.ts'
import { PULSE_HOST_Z_INDEX } from './overlayStacking.ts'
import type { TwitchPageContext } from './twitch.ts'
import { detectTwitchChannelLive } from './twitch.ts'

const TAB_HOST_ID = 'streamclone-pulse-tabs'
const PANEL_HOST_ID = 'streamclone-pulse-root'

let themeListenerInstalled = false
let colorSchemePreference: ColorSchemePreference = 'auto'
let accentPreference: ThemePreference = 'aurora'
let twitchColorScheme: TwitchColorScheme = 'dark'
let stopTwitchThemeObserve: (() => void) | null = null
let surfaceThemeMountGeneration = 0

function applyResolvedSurfaceTheme(): void {
  const resolved = resolvePulseColorScheme(colorSchemePreference, twitchColorScheme)
  if (tabsHostEl) {
    applySurfaceThemeToHost(tabsHostEl, resolved)
    applyAccentRolesToHost(tabsHostEl, accentPreference, resolved)
  }
  if (panelHostEl) {
    applySurfaceThemeToHost(panelHostEl, resolved)
    applyAccentRolesToHost(panelHostEl, accentPreference, resolved)
  }
}

function syncSurfaceThemeFromPreference(pref: ColorSchemePreference, generation: number): void {
  if (generation !== surfaceThemeMountGeneration) return
  colorSchemePreference = pref
  applyResolvedSurfaceTheme()
}

function syncAccentPreference(pref: ThemePreference): void {
  accentPreference = pref
  applyAccentTheme(pref)
  applyResolvedSurfaceTheme()
}

function installTwitchThemeObserver(): void {
  if (stopTwitchThemeObserve) return
  twitchColorScheme = detectTwitchColorScheme()
  applyResolvedSurfaceTheme()
  stopTwitchThemeObserve = observeTwitchColorScheme(scheme => {
    twitchColorScheme = scheme
    if (colorSchemePreference !== 'auto') return
    applyResolvedSurfaceTheme()
  })
}

function installThemeSyncListener(): void {
  if (themeListenerInstalled) return
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return
  themeListenerInstalled = true
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return
    if (changes[THEME_PREFERENCE_KEY]) {
      const next = changes[THEME_PREFERENCE_KEY].newValue
      if (next === 'aurora' || next === 'volt' || next === 'azure') {
        syncAccentPreference(next)
      }
    }
    if (changes[COLOR_SCHEME_PREFERENCE_KEY]) {
      const next = changes[COLOR_SCHEME_PREFERENCE_KEY].newValue
      const normalized =
        next === 'auto' || next === 'light' || next === 'dark'
          ? next
          : 'auto'
      // Removal / invalid values must snap back to auto immediately.
      syncSurfaceThemeFromPreference(normalized, surfaceThemeMountGeneration)
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
}

export function applyOverlayPayloadUpdate(
  previous: PulsePayload | null,
  incoming: PulsePayload | null,
): PulsePayload | null {
  if (!incoming) return previous
  const sameStream = !previous?.streamId || previous.streamId === incoming.streamId
  return sameStream && previous ? mergePulsePayload(previous, incoming) : incoming
}

const BASE_STYLE = `
  :host {
    display: block;
    font-family: ${theme.font};
    color: ${theme.textPrimary};
    pointer-events: none;
    position: fixed;
    z-index: ${PULSE_HOST_Z_INDEX};
    isolation: isolate;
    box-sizing: border-box;
    overflow: hidden;
  }
  * { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; }
  button:focus:not(:focus-visible) { outline: none; }
  button:focus-visible,
  [role="option"]:focus-visible,
  .pulse-segment-btn:focus-visible,
  .pulse-link-btn:focus-visible,
  .pulse-secondary-btn:focus-visible,
  .pulse-primary-btn:focus-visible {
    outline: 2px solid ${theme.accent};
    outline-offset: 2px;
    box-shadow: 0 0 0 2px var(--pulse-surface-focus-ring-contrast, #ffffff);
  }
  .pulse-no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
  .pulse-no-scrollbar::-webkit-scrollbar { display: none; width: 0; height: 0; }
  .pulse-panel-scroll {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .pulse-panel-scroll::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
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
    overflow: hidden;
    background: ${theme.panelGlass};
    border: 1px solid ${theme.borderAccent};
    border-radius: ${theme.radiusPanel}px;
    box-shadow: 0 22px 60px var(--pulse-surface-shadow, rgba(0, 0, 0, 0.55)), 0 0 0 1px var(--pulse-surface-border-subtle, rgba(255, 255, 255, 0.04)) inset;
    backdrop-filter: blur(14px);
    color: ${theme.textPrimary};
    font-family: ${theme.font};
    animation: pulse-shell-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes pulse-shell-in {
    from { opacity: 0; }
    to { opacity: 1; }
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
let currentSidebarTab: SidebarTab = 'pulse'
let currentOverlayMode: OverlayMode = 'expanded'
let currentPayload: PulsePayload | null = null
let currentError: string | undefined
let currentCoverageTier: ExtensionCoverageTierResponse | null = null

function createShadowHost(id: string): { host: HTMLElement; root: Root } {
  const host = document.createElement('div')
  host.id = id
  host.setAttribute('data-pulse-extension-owned', '1')
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

/** Remove exact-id duplicates; keep only `keep` when provided. */
function removeDuplicateHostsById(id: string, keep: HTMLElement | null): void {
  // Attribute selector — `#id` may only match the first node when IDs are duplicated.
  const all = Array.from(
    document.querySelectorAll(`[id="${CSS.escape(id)}"]`),
  ) as HTMLElement[]
  for (const el of all) {
    if (keep && el === keep) continue
    el.remove()
  }
}

/** Reuse in-module hosts; remove only exact stale extension hosts by id. */
function reclaimOrCreateShadowHost(
  id: string,
  ownedHost: HTMLElement | null,
  ownedRoot: Root | null,
): { host: HTMLElement; root: Root } {
  if (ownedHost && ownedRoot && document.contains(ownedHost) && ownedHost.id === id) {
    removeDuplicateHostsById(id, ownedHost)
    return { host: ownedHost, root: ownedRoot }
  }
  const existing = Array.from(
    document.querySelectorAll(`[id="${CSS.escape(id)}"]`),
  ) as HTMLElement[]
  const ownedExisting =
    existing.find((el) => el.getAttribute('data-pulse-extension-owned') === '1') ?? null
  removeDuplicateHostsById(id, ownedExisting)
  if (ownedExisting) {
    ownedExisting.remove()
  }
  return createShadowHost(id)
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
  host.style.right = ''
  host.style.bottom = ''
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

  // Opaque panel host covers native chat; never hide Twitch's message list.
  applyTwitchSidebarChromeHides(true)
  applyFixedRect(tabsHostEl, sidebarLayout.header, true)

  const showPanel = currentSidebarTab === 'pulse'
  if (!showPanel) {
    applyFixedRect(panelHostEl, null, false)
    if (panelHostEl) panelHostEl.style.overflow = ''
    return
  }

  const bodyRect = buildSidebarBodyRect(sidebarLayout)
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
    sidebarTab: currentSidebarTab,
  })
}

function syncSidebarObserver(): void {
  if (!placementResolved || storedPlacement === 'hidden') {
    stopObserve?.()
    stopObserve = null
    sidebarLayout = null
    resetSidebarFallback()
    return
  }
  // Always observe chat-column presence so chat-open forces sidebar snap even
  // when the stored placement preference is right/bottom (dock position only).
  if (stopObserve) return
  startSidebarObserver()
}

function installMountStorageListener(): void {
  if (mountStorageListenerInstalled) return
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return
  mountStorageListenerInstalled = true
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return
    if (changes.overlayPlacement || changes.overlayMode || changes[CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY]) {
      void Promise.all([getOverlayDisplayPreferences(), getChatClosedPulseDockEnabled()]).then(([display, dockEnabled]) => {
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
    onSidebarTabChange: (tab: SidebarTab) => {
      currentSidebarTab = tab
      renderOverlay(currentPayload, currentError)
    },
    onOverlayModeChange: (mode: OverlayMode) => {
      currentOverlayMode = mode
      renderOverlay(currentPayload, currentError)
    },
    onPulseRefresh: currentOptions.onPulseRefresh,
    onPulsePayloadUpdate: (message: PulseUpdateMessage) => {
      updateOverlayPayload(message.payload, message.error, message.coverageTier ?? null)
    },
    onLivePollWindowChange: currentOptions.onLivePollWindowChange,
    vodPulse: currentVodPulse,
    vodPulseLoading: currentVodPulseLoading,
  }

  if (sidebarSnapped) {
    tabsRoot?.render(
      <PulsePortalContext.Provider value={tabsHostEl?.shadowRoot ?? null}>
        <Overlay {...sharedProps} sidebarPart="tabs" />
      </PulsePortalContext.Provider>,
    )
    panelRoot?.render(
      <PulsePortalContext.Provider value={panelHostEl?.shadowRoot ?? null}>
        <Overlay {...sharedProps} sidebarPart="body" />
      </PulsePortalContext.Provider>,
    )
  } else {
    tabsRoot?.render(null)
    panelRoot?.render(
      <PulsePortalContext.Provider value={panelHostEl?.shadowRoot ?? null}>
        <Overlay {...sharedProps} sidebarPart="full" />
      </PulsePortalContext.Provider>,
    )
  }

  applyHostVisibility(visibility)

  if (placementResolved && chatClosedPulseDockEnabled && storedPlacement === 'sidebar' && sidebarLayout == null) {
    scheduleSidebarFallback()
  } else {
    resetSidebarFallback()
  }
}

function startSidebarObserver(): void {
  stopObserve?.()
  stopObserve = observeChatSnapLayout(next => {
    const prev = sidebarLayout
    sidebarLayout = next
    if (next != null) {
      resetSidebarFallback()
    } else if (placementResolved && chatClosedPulseDockEnabled && storedPlacement === 'sidebar') {
      scheduleSidebarFallback()
    }
    // Geometry-only ticks: reposition hosts without a full React Overlay render.
    // Presence / panel-width changes still need renderOverlay (sidebarSnapped, panelHostWidth).
    if (shouldRerenderOverlayForSnapChange(prev, next)) {
      renderOverlay(currentPayload, currentError)
    } else {
      applyHostVisibility(currentHostVisibility())
    }
  })
}

export function mountOverlay(
  login: string,
  initial: PulsePayload | null,
  context: TwitchPageContext,
  options: OverlayMountOptions = {},
): void {
  // Fail-open: clear orphaned hide styles / markers from a prior content lifecycle
  // before creating new hosts. Native Twitch chat must remain visible if mount fails.
  recoverStaleTwitchSidebarChrome()

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
  placementResolved = false
  resetSidebarFallback()

  if (!tabsHostEl || !tabsRoot || !document.contains(tabsHostEl)) {
    const tabs = reclaimOrCreateShadowHost(TAB_HOST_ID, tabsHostEl, tabsRoot)
    tabsHostEl = tabs.host
    tabsRoot = tabs.root
  } else {
    removeDuplicateHostsById(TAB_HOST_ID, tabsHostEl)
  }
  if (!panelHostEl || !panelRoot || !document.contains(panelHostEl)) {
    const panel = reclaimOrCreateShadowHost(PANEL_HOST_ID, panelHostEl, panelRoot)
    panelHostEl = panel.host
    panelRoot = panel.root
  } else {
    removeDuplicateHostsById(PANEL_HOST_ID, panelHostEl)
  }

  // Dark first paint — avoid light flash before storage / Twitch hydration.
  surfaceThemeMountGeneration += 1
  const themeMountGeneration = surfaceThemeMountGeneration
  applyResolvedSurfaceTheme()
  installTwitchThemeObserver()
  installThemeSyncListener()
  installMountStorageListener()
  void getThemePreference().then(pref => {
    if (themeMountGeneration !== surfaceThemeMountGeneration) return
    syncAccentPreference(pref)
  })
  void getColorSchemePreference().then(pref => {
    syncSurfaceThemeFromPreference(pref, themeMountGeneration)
  })
  syncSidebarObserver()
  renderOverlay(currentPayload, currentError)

  void Promise.all([
    getOverlayDisplayPreferences(),
    getSidebarTab(),
    getThemePreference(),
    getColorSchemePreference(),
    getChatClosedPulseDockEnabled(),
  ]).then(([display, tab, themePref, schemePref, dockEnabled]) => {
      if (themeMountGeneration !== surfaceThemeMountGeneration) return
      syncAccentPreference(themePref)
      syncSurfaceThemeFromPreference(schemePref, themeMountGeneration)
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
): void {
  if (!panelRoot || !currentLogin) return
  if (payload) {
    currentPayload = applyOverlayPayloadUpdate(currentPayload, payload)
  }
  currentError = resolveOverlayErrorState(currentError, payload, error)
  if (coverageTier !== undefined) {
    currentCoverageTier = coverageTier
  }
  renderOverlay(currentPayload, currentError)
}

export function updateOverlayContext(context: TwitchPageContext): void {
  if (
    currentContext.kind === context.kind
    && currentContext.login === context.login
    && currentContext.vodId === context.vodId
  ) {
    return
  }
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
  stopObserve?.()
  stopObserve = null
  stopTwitchThemeObserve?.()
  stopTwitchThemeObserve = null
  sidebarLayout = null
  placementResolved = false
  chatClosedPulseDockEnabled = false
  resetSidebarFallback()
  applyTwitchSidebarChromeHides(false)
  recoverStaleTwitchSidebarChrome()
  tabsRoot?.unmount()
  panelRoot?.unmount()
  tabsRoot = null
  panelRoot = null
  tabsHostEl?.remove()
  panelHostEl?.remove()
  tabsHostEl = null
  panelHostEl = null
  currentLogin = ''
  currentVodPulse = null
  currentVodPulseLoading = false
  currentOptions = {}
  currentPayload = null
  currentError = undefined
  currentCoverageTier = null
  currentSidebarTab = 'pulse'
  currentOverlayMode = 'expanded'
  colorSchemePreference = 'auto'
  accentPreference = 'aurora'
  twitchColorScheme = 'dark'
  surfaceThemeMountGeneration += 1
}

export function currentChannelLogin(): string {
  return currentLogin
}
