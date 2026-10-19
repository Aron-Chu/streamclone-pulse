/**
 * HubBucketCardHost: the d3 hub's selected-bucket card (plan §2.4, F4). U3 ships the
 * final props and a stub that renders nothing; U7 fills it in (dock / callout / sheet,
 * reading the selection store in lib/hubBucketSelection and the model in
 * lib/hubBucketCardModel).
 */
import type { HubCardCategory, HubCardFormatOptions } from '../../../../lib/hubBucketCardModel'
import type { HubActivityPoint, HubLivePulseMoment } from '../../../../lib/publicHub'
import type { HubApiWindow } from '../../../../lib/hubWindows'

export interface HubBucketCardHostProps {
  /** Hub activity points for the shown window (bucket totals over `bucketMinutes`). */
  points: readonly HubActivityPoint[]
  bucketMinutes: number
  activityWindow: HubApiWindow
  /** Optional category art when the backend names one for the bucket. */
  category?: HubCardCategory | null
  onOpenMoment?: (moment: HubLivePulseMoment) => void
  onZoomToBucket?: (range: { t: number; endT: number }) => void
  format?: HubCardFormatOptions
}

export function HubBucketCardHost(_props: HubBucketCardHostProps): null {
  return null
}
