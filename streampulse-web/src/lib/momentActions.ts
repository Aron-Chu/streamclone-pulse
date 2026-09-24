/**
 * Shared action resolver for a Live Wire moment card: turn a moment row into
 * the sibling analytics / VOD launch targets, or a disabled reason when nothing
 * can be launched. Mirrors the mounted FigmaMomentInspector behavior so the
 * right-rail rail and the inspector resolve identically.
 */
import { buildAnalyticsHref } from './analyticsLinks'
import { discoveryMomentHref, fromHubMoment } from './discoveryMoments'
import type { FigmaMomentRow } from './figmaSessionAnalytics'

export interface MomentActions {
  /** Canonical analytics route for the channel/session (or an explicit href). */
  analyticsHref?: string
  /** Exact-identity review route. Playback remains gated on its source check. */
  reviewHref?: string
  /** Set when no actionable target resolves (e.g. transient live-only row). */
  disabledReason?: string
}

export function resolveMomentActions(moment: FigmaMomentRow): MomentActions {
  const discoveryMoment = fromHubMoment(moment)
  const reviewHref = discoveryMoment ? discoveryMomentHref(discoveryMoment) : undefined
  const analyticsHref =
    moment.href ??
    (moment.login
      ? buildAnalyticsHref({
          login: moment.login,
          streamId: moment.streamId,
          offsetSeconds: moment.offsetSeconds,
        })
      : undefined)

  if (!analyticsHref && !reviewHref) {
    return { disabledReason: 'Live tracking only' }
  }
  return { analyticsHref, reviewHref }
}
