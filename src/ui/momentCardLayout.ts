/**
 * Height the Top Moments card opens to, so swapping one moment for another
 * never moves the list below it: a moment with three top emotes and one-line
 * reason and activity lines, the reserved action rows, and the card's 8 px
 * bottom margin. Its slot holds any taller height it shows until it closes.
 */
export const MOMENT_CARD_ACTIONS_HEIGHT = 60
export const MOMENT_CARD_HEIGHT = 195 + MOMENT_CARD_ACTIONS_HEIGHT - 28

/** The card's game line (16 px box art and its 4 px margin), reserved when the stream names its games. */
export const MOMENT_CARD_GAME_LINE_HEIGHT = 20
