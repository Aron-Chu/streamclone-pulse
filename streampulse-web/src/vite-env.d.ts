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
  /** "1" turns on the header account entry (Sign in link / account menu); anything else leaves the header as before. */
  readonly VITE_ACCOUNT_HEADER?: string
  /** Activation input: Cloudflare Turnstile site key. Without it the support form stays unavailable. */
  readonly VITE_TURNSTILE_SITE_KEY?: string
  /** Activation input: public Discord invite. Without a valid one every Discord link is hidden. */
  readonly VITE_PUBLIC_DISCORD_INVITE_URL?: string
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
