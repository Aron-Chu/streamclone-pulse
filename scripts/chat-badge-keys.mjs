/**
 * Build-time verification keys for the Seen in chat list (non-store builds only).
 *
 * Store builds (cws, edge, firefox) pin only the production keys written in
 * src/shared/chatBadgeKeys.ts and never take a key from the environment.
 * Development builds pin the throwaway e2e key below so the mocked e2e suite
 * can sign lists, plus any keys in PULSE_CHAT_BADGE_DEV_KEYS (a JSON array of
 * {kid, key}), e.g. the owner's sandbox key. The e2e seed is public on purpose:
 * it is 32 bytes of 0x07, the same fixed test seed the backend golden uses, so
 * it must never be pinned by a store build (tests/chatBadgeKeys.test.ts).
 */
export const E2E_CHAT_BADGE_KEY = Object.freeze({ kid: 'spb-sandbox-7', key: '6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw' })

const KID = /^spb-(live|sandbox)-[0-9]{1,4}$/
const KEY = /^[A-Za-z0-9_-]{43}$/

export function resolveChatBadgeDevKeys(target, raw = process.env.PULSE_CHAT_BADGE_DEV_KEYS) {
  if (target === 'cws' || target === 'edge' || target === 'firefox') return []
  const keys = [E2E_CHAT_BADGE_KEY]
  if (raw && raw.trim()) {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('PULSE_CHAT_BADGE_DEV_KEYS must be a JSON array of {kid, key}')
    for (const entry of parsed) {
      if (!entry || !KID.test(entry.kid) || !KEY.test(entry.key)) throw new Error(`PULSE_CHAT_BADGE_DEV_KEYS: invalid key entry ${JSON.stringify(entry)}`)
      if (!keys.some(existing => existing.kid === entry.kid)) keys.push({ kid: entry.kid, key: entry.key })
    }
  }
  return keys
}
