/**
 * What the Twitch sign-in flow tells My Moments, without importing it: the
 * sign-in module stays free of My Moments' IndexedDB store, and the tests
 * that mock the account runtime need no new export. My Moments binds the
 * real hooks when the worker loads it; unbound, both do nothing.
 */
export interface AccountHooks {
  /** "Not you?": sends watched history not yet sent for the signed-in account. Bounded; never rejects. */
  flush(): Promise<void>
  /** A Twitch account signed in on this browser. Never rejects. */
  seen(accountId: string): Promise<void>
}
let bound: AccountHooks | null = null
export function bindAccountHooks(hooks: AccountHooks): void { bound = hooks }
export const accountHooks: AccountHooks = {
  flush: () => bound?.flush() ?? Promise.resolve(),
  seen: accountId => bound?.seen(accountId) ?? Promise.resolve(),
}
