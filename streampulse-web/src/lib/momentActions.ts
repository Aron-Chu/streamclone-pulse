/**
 * Shared action resolver for a Live Wire moment card: turn a moment row into
 * the sibling analytics / VOD launch targets, or a disabled reason when nothing
 * can be launched. Mirrors the mounted FigmaMomentInspector behavior so the
 * chart annotation lane and the inspector resolve identically.
 */
import { buildAnalyticsHref } from './analyticsLinks'
import type { FigmaMomentRow } from './figmaSessionAnalytics'
import { buildVodTimestampUrl } from './figmaSessionAnalytics'

export interface MomentActions {
  /** Canonical analytics route for the channel/session (or an explicit href). */
  analyticsHref?: string
  /** Twitch VOD deep-link when the moment is tied to a VOD. */
  vodHref?: string
  /** Set when no actionable target resolves (e.g. transient live-only row). */
  disabledReason?: string
}

export function resolveMomentActions(moment: FigmaMomentRow): MomentActions {
  const analyticsHref =
    moment.href ??
    (moment.login
      ? buildAnalyticsHref({
          login: moment.login,
          streamId: moment.streamId,
          offsetSeconds: moment.offsetSeconds,
        })
      : undefined)

  const vodHref = moment.vodId ? buildVodTimestampUrl(moment.vodId, moment.offsetSeconds) : undefined

  if (!analyticsHref && !vodHref) {
    return { disabledReason: 'Live tracking only' }
  }
  return { analyticsHref, vodHref }
}
