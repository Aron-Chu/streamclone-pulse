export type ReviewStoreTarget = 'development' | 'cws' | 'firefox' | 'edge'

/** Fixed public destinations only. Edge waits for its verified listing. */
export function reviewDestination(target: ReviewStoreTarget = typeof __EXTENSION_TARGET__ === 'undefined' ? 'development' : __EXTENSION_TARGET__): string | null {
  if (target === 'firefox') return 'https://addons.mozilla.org/en-US/firefox/addon/streampulse/reviews/'
  if (target === 'cws' || target === 'development') return 'https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg/reviews'
  return null
}
