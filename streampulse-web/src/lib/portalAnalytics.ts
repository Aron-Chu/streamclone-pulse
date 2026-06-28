import { apiClient, type ApiClientResult } from './apiClient'

/**
 * Portal-safe analytics client for streampulse-web.
 * Prefer /v1/portal/analytics/* (server-sanitized) over raw /v1/analytics/*.
 * Hub home poll must not call these — use publicHub / publicEmotesOverview only.
 */

export const PORTAL_ANALYTICS_PREFIX = '/v1/portal/analytics'

/** Allowlisted raw /v1/analytics/* paths for public aggregate ops (not stream timelines). */
export const ALLOWLIST_PUBLIC_ANALYTICS_AGGREGATE = [
  '/v1/analytics/top100/readiness',
  '/v1/analytics/top-roster/readiness',
] as const

export function isAllowlistedPublicAnalyticsPath(path: string): boolean {
  const base = path.split('?')[0] ?? path
  return ALLOWLIST_PUBLIC_ANALYTICS_AGGREGATE.some((prefix) => base.startsWith(prefix))
}

export interface PortalStreamMinutesResponse {
  minutes?: unknown[]
  [key: string]: unknown
}

export interface PortalStreamDetailResponse {
  rollups?: unknown
  [key: string]: unknown
}

export function portalStreamMinutesPath(streamId: string): string {
  return `${PORTAL_ANALYTICS_PREFIX}/streams/${encodeURIComponent(streamId)}/minutes`
}

export function portalStreamDetailPath(streamId: string): string {
  return `${PORTAL_ANALYTICS_PREFIX}/streams/${encodeURIComponent(streamId)}`
}

export function portalStreamSummaryPath(streamId: string): string {
  return `${PORTAL_ANALYTICS_PREFIX}/streams/${encodeURIComponent(streamId)}/summary`
}

export function portalStreamSyncStatusPath(streamId: string): string {
  return `${PORTAL_ANALYTICS_PREFIX}/streams/${encodeURIComponent(streamId)}/sync/status`
}

/** Gated portal minutes — explicit channel/stream navigation only. */
export async function fetchPortalStreamMinutes(
  streamId: string,
  signal?: AbortSignal,
): Promise<ApiClientResult<PortalStreamMinutesResponse>> {
  return apiClient<PortalStreamMinutesResponse>(portalStreamMinutesPath(streamId), {
    gated: true,
    signal,
  })
}

export async function fetchPortalStreamDetail(
  streamId: string,
  signal?: AbortSignal,
): Promise<ApiClientResult<PortalStreamDetailResponse>> {
  return apiClient<PortalStreamDetailResponse>(portalStreamDetailPath(streamId), {
    gated: true,
    signal,
  })
}
