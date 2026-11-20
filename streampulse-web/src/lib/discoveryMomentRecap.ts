import type { DiscoveryMoment } from './discoveryMoments'
import { loadMomentRecap, untilStopped } from './momentReads'

type RecapRow = {
  offsetSeconds?: number; publicMomentId?: string; reasons?: string[];
  topEmotes?: Array<{ code?: string; count?: number; provider?: string; imageUrl?: string }>;
}
/** The recap route's answer, as far as a moment reads it. */
export interface MomentRecapAnswer { login?: string; streamId?: string; topMoments?: RecapRow[] }
type Found = { kind: 'unknown' } | { kind: 'unlisted' } | { kind: 'row'; row: RecapRow }
type RecapMoment = Pick<DiscoveryMoment, 'login' | 'streamId' | 'offsetSeconds' | 'publicMomentId'>

function findRow(moment: RecapMoment, data: MomentRecapAnswer | null | undefined): Found {
  // A recap for another login or stream, or one without a list, says nothing about this minute.
  if (data?.login?.toLowerCase() !== moment.login || data.streamId !== moment.streamId || !Array.isArray(data.topMoments)) return { kind: 'unknown' }
  const matches = data.topMoments.filter(row => row.offsetSeconds === moment.offsetSeconds
    && (!moment.publicMomentId || row.publicMomentId === moment.publicMomentId))
  if (matches.length === 0) return { kind: 'unlisted' }
  return matches.length === 1 ? { kind: 'row', row: matches[0]! } : { kind: 'unknown' }
}

/** Through the stream's one shared recap read; the caller's signal stops only its own wait. */
async function findInRecap(moment: DiscoveryMoment, signal: AbortSignal): Promise<Found> {
  return findRow(moment, await untilStopped(() => loadMomentRecap(moment.streamId), signal))
}

/**
 * Whether the recap lists the Moment: true or false for a well-formed recap,
 * a throw when it cannot tell (a mismatched or malformed recap, a duplicate
 * row, no answer). Only a false means "no longer listed".
 */
export async function momentRecapLists(moment: DiscoveryMoment, signal: AbortSignal): Promise<boolean> {
  const found = await findInRecap(moment, signal)
  if (found.kind === 'unknown') throw new Error('the recap could not say')
  return found.kind === 'row'
}

function recapDetails(row: RecapRow): Partial<DiscoveryMoment> {
  const reasons = Array.isArray(row.reasons) ? row.reasons : []
  const label = reasons.some(reason => typeof reason === 'string' && (reason.includes('emote_spike') || reason === 'seventv_spike')) ? 'Emote spike'
    : reasons.includes('chat_spike') ? 'Chat spike' : 'Measured reaction'
  const topEmotes = Array.isArray(row.topEmotes) ? row.topEmotes.slice(0, 5).flatMap(emote => {
    if (typeof emote.code !== 'string' || !emote.code || emote.code.length > 100) return []
    return [{ name: emote.code, provider: typeof emote.provider === 'string' ? emote.provider : undefined,
      imageUrl: typeof emote.imageUrl === 'string' ? emote.imageUrl : undefined,
      count: typeof emote.count === 'number' && Number.isFinite(emote.count) && emote.count >= 0 ? emote.count : undefined }]
  }) : []
  // Recap aggregate counts have a different contract from minute rates. Do not relabel them /min.
  return { label, topEmotes }
}

/** Selected-only hydration, never a nearby/lead-moment substitution or a history poll. */
export async function loadExactMomentRecap(moment: DiscoveryMoment, signal: AbortSignal): Promise<Partial<DiscoveryMoment> | null> {
  const found = await findInRecap(moment, signal)
  return found.kind === 'row' ? recapDetails(found.row) : null
}

/** The recap's row for exactly this moment, on an answer already read: its label and top emotes; null when the recap does not list it once. */
export function exactMomentRecapFrom(moment: RecapMoment, data: MomentRecapAnswer | null | undefined): Partial<DiscoveryMoment> | null {
  const found = findRow(moment, data)
  return found.kind === 'row' ? recapDetails(found.row) : null
}
