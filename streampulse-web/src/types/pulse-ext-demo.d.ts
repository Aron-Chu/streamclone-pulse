/**
 * Types for the extension modules the /extension demo imports (src/demo/).
 * Vite resolves them to the extension's own source (extension-demo.config.ts);
 * the site's typecheck sees only these declarations.
 *
 * This file must stay a script (no top-level import or export): only then are
 * these ambient module declarations, rather than augmentations of modules the
 * site's typecheck can't resolve.
 */

declare module '@pulse-ext/vod/normalizeVodPulseFetch.ts' {
  /** The worker's VOD answer (src/types/vodPulseTypes.ts): the fields the demo reads. */
  export interface ExtensionVodPulseResponse {
    mode: string
    vodId: string | null
    streamId?: string | null
    login?: string
    channelLogin?: string
    title?: string
    startedAt?: string
    durationSeconds?: number
    games?: Array<{ gameName: string; offsetSeconds: number; durationSeconds: number }>
    [key: string]: unknown
  }
  export function parseExtensionVodPulseResponse(raw: Record<string, unknown>): ExtensionVodPulseResponse
}

declare module '@pulse-ext/vod/vodPulseToChannelPayload.ts' {
  import type { ExtensionVodPulseResponse } from '@pulse-ext/vod/normalizeVodPulseFetch.ts'
  /** The panel's channel payload; the demo only passes it through. */
  export type PulsePayload = Record<string, unknown>
  export function vodPulseToChannelPayload(vod: ExtensionVodPulseResponse, fallbackLogin?: string): PulsePayload | null
}

declare module '@pulse-ext/ui/Overlay.tsx' {
  import type { ComponentType } from 'react'
  import type { ExtensionVodPulseResponse } from '@pulse-ext/vod/normalizeVodPulseFetch.ts'
  import type { PulsePayload } from '@pulse-ext/vod/vodPulseToChannelPayload.ts'
  type SidebarTab = 'chat' | 'pulse'
  type OverlayMode = 'collapsed' | 'mini' | 'expanded'
  export const Overlay: ComponentType<{
    login: string
    context: { kind: 'channel' | 'vod' | 'non-channel'; login: string | null; vodId: string | null }
    payload: PulsePayload | null
    error?: string
    sessionOpenedAtMs?: number | null
    coverageTier?: null
    effectivePlacement?: 'bottom' | 'right' | 'sidebar' | 'hidden'
    sidebarSnapped?: boolean
    sidebarPart?: 'tabs' | 'body' | 'full'
    panelHostWidth?: number
    pageIsLive?: boolean
    sidebarTab?: SidebarTab
    overlayMode?: OverlayMode
    onSidebarTabChange?: (tab: SidebarTab, source?: 'user' | 'sync') => void
    onOverlayModeChange?: (mode: OverlayMode) => void
    vodPulse?: ExtensionVodPulseResponse | null
    vodPulseLoading?: boolean
  }>
}

declare module '@pulse-ext/ui/overlayStyles.ts' {
  export const overlayStyles: string
}

declare module '@pulse-ext/ui/overlayTheme.ts' {
  export function applyAccentTheme(pref: 'aurora' | 'volt' | 'azure' | 'emerald'): void
}

declare module '@pulse-ext/ui/theme.ts' {
  export const shadowStyles: string
}

declare module '@pulse-ext/ui/pulsePortalContext.ts' {
  import type { Context } from 'react'
  export const PulsePortalContext: Context<ShadowRoot | Document | null>
}

declare module '@pulse-ext/content/twitchLayout.ts' {
  export const SIDEBAR_MINI_PANEL_HEIGHT: number
  export const SIDEBAR_COLLAPSED_PILL_HEIGHT: number
}

/** Side effect only: puts the Catch me up script on globalThis, as its content script does. */
declare module '@pulse-ext/content/catchMeUp.ts' {}

declare module '@pulse-ext/shared/storage.ts' {
  export type ThemePreference = 'aurora' | 'volt' | 'azure' | 'emerald'
  export function getThemePreference(): Promise<ThemePreference>
  export function themeFromStorageChange(changes: Record<string, { newValue?: unknown }>): ThemePreference | undefined
}
