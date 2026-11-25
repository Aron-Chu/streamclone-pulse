/**
 * The cue under the front page's hero (LandingScrollCue) sends this window event when it takes the visitor to the
 * demo; the demo (besideChat/LandingBesideChat) plays from the top when it hears it. Kept apart so the cue does not
 * load the demo's code.
 */
export const DEMO_PLAY_EVENT = 'sl-demo-play'

/** When the visitor last asked, if no demo has answered yet (performance.now() ms). */
let askedAt: number | null = null

/** Asks the demo to play from the top. A demo whose code is still loading picks the request up when it starts. */
export function requestDemoPlay(): void {
  askedAt = performance.now()
  window.dispatchEvent(new Event(DEMO_PLAY_EVENT))
}

/** The time of a request no demo has answered yet, or null; answering clears it. */
export function takeDemoPlayRequest(): number | null {
  const at = askedAt
  askedAt = null
  return at
}
