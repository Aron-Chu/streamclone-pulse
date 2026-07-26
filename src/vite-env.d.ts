/// <reference types="vite/client" />

declare const __EXTENSION_DEV_RELOAD__: boolean
/** True for CWS/Edge store builds — development-only controls are compiled out. */
declare const __EXTENSION_STORE_BUILD__: boolean
/** Build-time packaging target: development | cws | edge. */
declare const __EXTENSION_TARGET__: 'development' | 'cws' | 'edge'
