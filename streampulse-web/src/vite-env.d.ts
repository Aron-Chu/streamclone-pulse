/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string
  readonly VITE_PUBLIC_HUB_POLL_MS?: string
  readonly VITE_PORTAL_VERSION?: string
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_POSTHOG_PROJECT_TOKEN?: string
  readonly VITE_REPLAYFORGE_UI_ORIGIN?: string
  readonly VITE_STREAMCLONE_WATCH_ORIGIN?: string
  /** "1" turns on Sign in with Twitch on the website; anything else leaves it off. */
  readonly VITE_TWITCH_SIGNIN?: string
  /** "1" turns on My Moments on the website (account bookmarks and synced history). */
  readonly VITE_ACCOUNT_MOMENTS?: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css' {
  const css: string
  export default css
}
