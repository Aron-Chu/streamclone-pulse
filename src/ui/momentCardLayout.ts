/**
 * Reserved height for the inspector slot. The inspector itself uses this as a
 * `min-height`, not a fixed height, so the ranked-moment variant (which adds a
 * reason row) can grow while the minute variant stays compact. The tray uses
 * the same value so the surrounding layout does not shift when a card appears.
 */
export const MOMENT_CARD_HEIGHT = 184
