import { MOMENT_PICTURE_WANTS, savedPictureView, type MomentPictureWant } from '../shared/momentFramesContract.ts'
import { momentPictures, type MomentPictureStore } from '../shared/momentPictureStore.ts'
import { MAX_PICTURE_BYTES, type MomentPictureRequest } from '../shared/momentPictureMessages.ts'
import { getMomentPicturesEnabled } from '../shared/storage.ts'

/**
 * Keeps a moment's picture with it when it is saved or watched: the worker
 * asks the tab it happened in for the frame content/moment-frames.js already
 * holds, and stores the answer on this device (src/shared/momentPictureStore.ts).
 *
 * Asking only goes to that tab and frame, only while Moment pictures is on,
 * never from a private window. Each request answers once, from that tab, with
 * a JPEG of a second inside the moment's span, while the tab still shows the
 * moment's channel or VOD.
 */

export interface PictureMoment {
  channel: string
  vodId: string | null
  streamId?: string
  offsetSeconds: number
}

interface PendingPicture extends MomentPictureWant {
  tabId: number
  frameId: number
  scope: string
  identity: string
  moment: PictureMoment
  /** A save just made: no need to check it is still listed. */
  owned: boolean
}

export interface PictureDeps {
  enabled: () => Promise<boolean>
  send: (tabId: number, message: unknown, frameId: number) => Promise<unknown>
  store: MomentPictureStore
  now: () => number
  token: () => string
}

const defaults: PictureDeps = {
  enabled: () => getMomentPicturesEnabled(),
  send: (tabId, message, frameId) => chrome.tabs.sendMessage(tabId, message, { frameId }),
  store: momentPictures,
  now: () => Date.now(),
  token: () => crypto.randomUUID(),
}

const pending = new Map<string, PendingPicture>()

function prune(now: number): void {
  for (const [token, want] of pending) if (want.until <= now) pending.delete(token)
}

function openFor(tabId: number, frameId: number): MomentPictureWant[] {
  return [...pending.values()].filter(want => want.tabId === tabId && want.frameId === frameId)
    .map(({ token, stream, from, to, peak, until }) => ({ token, ...(stream ? { stream } : {}), from, to, peak, until }))
}

/** Asks the sender's tab for the frame of `moment`, unless the moment already has a picture. */
export async function wantPicture(sender: chrome.runtime.MessageSender, moment: PictureMoment, scope: string, identity: string,
  options: { owned: boolean; waitMs: number }, deps: PictureDeps = defaults): Promise<void> {
  const tabId = sender.tab?.id
  const frameId = sender.frameId ?? 0
  if (typeof tabId !== 'number' || tabId < 0 || sender.tab?.incognito) return
  if (!Number.isFinite(moment.offsetSeconds) || moment.offsetSeconds < 0) return
  if (!(await deps.enabled().catch(() => false))) return
  if (await deps.store.has(scope, identity).catch(() => true)) return
  const now = deps.now()
  prune(now)
  for (const [token, want] of pending) if (want.tabId === tabId && want.scope === scope && want.identity === identity) pending.delete(token)
  const token = deps.token()
  pending.set(token, {
    ...savedPictureView(moment.offsetSeconds), token, until: now + options.waitMs,
    ...(moment.streamId ? { stream: moment.streamId } : {}), tabId, frameId, scope, identity, moment, owned: options.owned,
  })
  await deps.send(tabId, { type: MOMENT_PICTURE_WANTS, wants: openFor(tabId, frameId) }, frameId).catch(() => undefined)
}

/** A base64 JPEG data URL as a Blob, or null for anything else. */
export function jpegFromDataUrl(image: string): Blob | null {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
  if (!match) return null
  let binary: string
  try { binary = atob(match[1]!) } catch { return null }
  if (binary.length > MAX_PICTURE_BYTES || binary.length < 4) return null
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null
  return new Blob([bytes], { type: 'image/jpeg' })
}

/** The tab still shows the moment's channel (any capitals, trailing slash) or its VOD. */
function onMomentPage(sender: chrome.runtime.MessageSender, moment: PictureMoment): boolean {
  try {
    const path = new URL(sender.tab?.url ?? 'https://invalid/').pathname.replace(/\/+$/, '').toLowerCase()
    return path === `/${moment.channel.toLowerCase()}` || (!!moment.vodId && path === `/videos/${moment.vodId}`)
  } catch { return false }
}

export async function handleMomentPicture(message: MomentPictureRequest, sender: chrome.runtime.MessageSender,
  listed: (scope: string, identity: string, moment: PictureMoment) => Promise<boolean>, deps: PictureDeps = defaults) {
  const tabId = sender.tab?.id ?? -1
  const frameId = sender.frameId ?? 0
  prune(deps.now())
  if (message.action === 'wants') return { type: 'MOMENT_PICTURE' as const, wants: openFor(tabId, frameId) }
  const want = pending.get(message.token)
  if (!want || want.tabId !== tabId || want.frameId !== frameId) return { type: 'MOMENT_PICTURE' as const, ok: false }
  pending.delete(message.token)
  const image = jpegFromDataUrl(message.image)
  const fits = message.offset >= want.from && message.offset <= want.to
  if (!image || !fits || !onMomentPage(sender, want.moment) || !(await deps.enabled().catch(() => false))) return { type: 'MOMENT_PICTURE' as const, ok: false }
  // A watched moment keeps a picture only while it is saved or in History.
  if (!want.owned && !(await listed(want.scope, want.identity, want.moment).catch(() => false))) return { type: 'MOMENT_PICTURE' as const, ok: false }
  return { type: 'MOMENT_PICTURE' as const, ok: await deps.store.attach(want.scope, want.identity, image, Math.round(message.offset), deps.now()) }
}

/** Tests only. */
export function resetPictureWants(): void {
  pending.clear()
}
