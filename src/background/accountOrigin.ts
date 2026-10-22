import { DEFAULT_BACKEND_URL } from '../shared/storage.ts'

/**
 * The one origin every account request goes to: the credential store, refresh,
 * Twitch sign-in, saves and history. Production in every store build; a
 * development build pinned to a local backend keeps all of them there, so a
 * credential issued by one origin is never sent to another.
 */
export const ACCOUNT_BACKEND_URL: string = typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__ ? DEFAULT_BACKEND_URL
  : typeof __SUPPORTER_BACKEND_ORIGIN__ !== 'undefined' ? __SUPPORTER_BACKEND_ORIGIN__ : DEFAULT_BACKEND_URL
