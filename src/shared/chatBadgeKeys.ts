import type { ChatBadgeEnvironment, ChatBadgeKey } from './chatBadges.ts'

declare const __CHAT_BADGE_DEV_KEYS__: ChatBadgeKey[] | undefined

/**
 * Production keys for the Seen in chat list (owner decision D5).
 *
 * The owner generates the Ed25519 keys offline: `spb-live-1` (active) and
 * `spb-live-2` (standby), and hands over the public halves to pin here. Until
 * then this list is empty and store builds verify nothing, so the feature
 * stays inert: no list is ever accepted, no chat script is registered.
 *
 * Rotation: the server switches to the standby key; the next release pins the
 * standby and a new one and drops the old.
 */
export const STORE_CHAT_BADGE_KEYS: readonly ChatBadgeKey[] = []

/** Store builds honour live lists only; development builds also take sandbox ones. */
export function chatBadgeEnvironments(store: boolean): ChatBadgeEnvironment[] {
  return store ? ['live'] : ['live', 'sandbox']
}

/**
 * The keys this build verifies with. Development and e2e builds add the keys
 * from the build-time define (scripts/chat-badge-keys.mjs); store builds never do.
 */
export function pinnedChatBadgeKeys(
  store: boolean = typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__,
  devKeys: readonly ChatBadgeKey[] = typeof __CHAT_BADGE_DEV_KEYS__ !== 'undefined' ? __CHAT_BADGE_DEV_KEYS__ ?? [] : [],
): ChatBadgeKey[] {
  return store ? [...STORE_CHAT_BADGE_KEYS] : [...STORE_CHAT_BADGE_KEYS, ...devKeys.filter(key => !STORE_CHAT_BADGE_KEYS.some(pinned => pinned.kid === key.kid))]
}
