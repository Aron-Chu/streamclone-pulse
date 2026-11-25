/**
 * The front page's two animations share one main thread: the hero background (heroBackdrop/engine.ts) draws
 * less often while the extension demo's 3D scene is drawing. The scene marks each frame it draws; the
 * background asks whether one was drawn in the last quarter second, so a stopped or hidden scene frees it
 * without a message of its own.
 */

const SCENE_RECENT_MS = 250

let sceneAt = Number.NEGATIVE_INFINITY

export function markSceneFrame(now: number = performance.now()): void {
  sceneAt = now
}

export function sceneBusy(now: number = performance.now()): boolean {
  return now - sceneAt < SCENE_RECENT_MS
}
