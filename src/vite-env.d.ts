/// <reference types="vite/client" />

declare const __EXTENSION_DEV_RELOAD__: boolean
/** True for CWS/Edge store builds — development-only controls are compiled out. */
declare const __EXTENSION_STORE_BUILD__: boolean
/** Build-time packaging target: development | cws | edge | firefox. */
declare const __EXTENSION_TARGET__: 'development' | 'cws' | 'edge' | 'firefox'
/** Exact runtime/manifest target binding inspected by package validation. */
declare const __EXTENSION_TARGET_MARKER__: string
/** Worktree-sensitive build identity shown by runtime diagnostics. */
declare const __EXTENSION_BUILD_ID__: string
/** Three-line current-release summary injected without bundling full release notes. */
declare const __EXTENSION_RELEASE_PREVIEW__: {
  version: string
  title: string
  bullets: [string, string, string]
}
