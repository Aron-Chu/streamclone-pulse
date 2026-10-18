/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string
  readonly VITE_PUBLIC_HUB_POLL_MS?: string
  readonly VITE_PORTAL_VERSION?: string
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_POSTHOG_PROJECT_TOKEN?: string
  readonly VITE_REPLAYFORGE_UI_ORIGIN?: string
  readonly VITE_STREAMCLONE_WATCH_ORIGIN?: string
  /** Activation input: Cloudflare Turnstile site key. Without it the support form stays unavailable. */
  readonly VITE_TURNSTILE_SITE_KEY?: string
  /** Activation input: public Discord invite. Without a valid one every Discord link is hidden. */
  readonly VITE_PUBLIC_DISCORD_INVITE_URL?: string
  /** Launch switch: `on` shows the optional "Seen in chat" Supporter copy (lib/supporterChatBadgesFlag.ts). */
  readonly VITE_SUPPORTER_CHAT_BADGES?: string
  /** Build switch: `on` (or `1`) serves the d3-v5 hub on /analytics (read inline so a flag-off build folds it away). Off: the Command Center page. */
  readonly VITE_PUBLIC_HUB_V5?: string
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
