import { reactionAnalyticalOffset, type LiveHeatPoint, type ReactionIdentityFields } from '@streampulse/pulse-core'
import { keptVodOriginDelta } from '../shared/vodOriginAlignment.ts'
import type { MomentReference } from './library/model.ts'

/**
 * The one second a ranked moment is kept at: by its bookmark, by History after
 * a jump in this tab, and by the note a new tab's arrival reads. My Moments
 * knows a moment by channel, stream (or VOD) and this whole second
 * (`momentIdentity`), so a watched moment and its save are the same row only
 * when every path keeps the same second. It is the moment's analytical offset:
 * the reaction onset when the moment is second-precise, else its minute.
 */
export function keptMomentSecond(point: ReactionIdentityFields): number {
  return reactionAnalyticalOffset(point)
}

/**
 * History's reference for a ranked moment watched after a jump in this tab.
 * `payloadVodId` and its delta come from the panel payload: the delta is that
 * VOD's, so the entry keeps it only when it names the same VOD.
 */
export function jumpHistoryReference(point: Pick<LiveHeatPoint, 'reasonLabel'> & ReactionIdentityFields, at: {
  login: string
  vodId: string | null
  streamId?: string
  payloadVodId?: string | null
  payloadVodOriginDeltaSeconds?: number
}): MomentReference {
  const delta = at.vodId && at.vodId === at.payloadVodId ? keptVodOriginDelta(at.payloadVodOriginDeltaSeconds) : undefined
  return { id: 'moment', channel: at.login, title: point.reasonLabel, vodId: at.vodId, streamId: at.streamId, offsetSeconds: keptMomentSecond(point),
    ...(delta === undefined ? {} : { vodOriginDeltaSeconds: delta }), availability: 'unresolved' }
}
