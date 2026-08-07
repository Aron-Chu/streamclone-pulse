/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string
  readonly VITE_PUBLIC_HUB_POLL_MS?: string
  readonly VITE_PORTAL_VERSION?: string
  readonly VITE_SENTRY_DSN?: string
  /** Stage 3 portal promotion — must be `'true'` to fetch live-activity. Default OFF. */
  readonly VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED?: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __STREAMPULSE_BUILD_META__: {
  repository: string
  commit: string
  dirty: boolean
  dirtyTreeHash: string
  sourceFingerprint: string
  packageCohortFingerprint: string
  snapshotId?: string | null
  mode: string
  buildId: string
  builtAt: string
} | undefined

declare module '*.css' {
  const css: string
  export default css
}
