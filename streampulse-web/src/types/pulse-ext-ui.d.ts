import type { ComponentType, CSSProperties, ReactNode } from 'react'

type LandingPulsePayload = import('./ui/components/landing/landingExtensionTypes.ts').LandingPulsePayload
type LandingPastVodRow = import('./ui/components/landing/landingExtensionTypes.ts').LandingPastVodRow

declare module '@pulse-ext/ui/LiveStatsBand.tsx' {
  export const LiveStatsBand: ComponentType<{
    payload: LandingPulsePayload
    backendUrl: string
    sidebarFill?: boolean
    isLive?: boolean
    currentOffsetSeconds?: number
    coverageStartOffsetSeconds?: number
    demoMode?: boolean
  }>
}

declare module '@pulse-ext/ui/MostReactedSection.tsx' {
  export const MostReactedSection: ComponentType<{
    payload: LandingPulsePayload
    backendUrl: string
    sidebarFill?: boolean
    onJump: (point: unknown) => void
    onSave: (point: unknown) => void
    onAnalytics: (point: unknown) => void
    demoMode?: boolean
  }>
}

declare module '@pulse-ext/ui/PastVodsSection.tsx' {
  export const PastVodsSection: ComponentType<{
    login: string
    backendUrl: string
    liveStreamId?: string
    isLive?: boolean
    demoRows?: LandingPastVodRow[]
    demoMode?: boolean
  }>
}

declare module '@pulse-ext/ui/PulseSidebarTabs.tsx' {
  export const PulseSidebarTabs: ComponentType<{
    active: 'chat' | 'pulse'
    demoMode?: boolean
  }>
}

declare module '@pulse-ext/ui/PulseSectionCard.tsx' {
  export const PulseSectionCard: ComponentType<{
    title: string
    subtitle?: string
    titleTone?: string
    meta?: ReactNode
    style?: CSSProperties
    children?: ReactNode
  }>
}

declare module '@pulse-ext/ui/overlayTheme.ts' {
  export function applyAccentTheme(pref: 'aurora' | 'volt' | 'azure'): void
}

declare module '@pulse-ext/ui/theme.ts' {
  export const theme: {
    textPrimary: string
    textSecondary: string
    textMuted: string
    accent: string
    accentSoft: string
    live: string
  }
  export const shadowStyles: string
}

export {}
