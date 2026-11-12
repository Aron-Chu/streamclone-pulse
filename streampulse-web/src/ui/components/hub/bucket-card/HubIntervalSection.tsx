/**
 * HubIntervalSection: the moments list for the selected bucket or bar (plan §2.4).
 * U3 ships the final props and a stub that renders nothing; U7 fills it in on top of
 * lib/hubIntervalMoments (at most 5 bucket reads, 2 in flight, '10+' at the limit,
 * "Zoom in to list moments" for long windows).
 */
import type { HubCardFormatOptions } from '../../../../lib/hubBucketCardModel'
import type { HubLivePulseMoment } from '../../../../lib/publicHub'
import type { HubApiWindow } from '../../../../lib/hubWindows'

export interface HubIntervalSectionProps {
  activityWindow: HubApiWindow
  bucketMinutes: number
  onOpenMoment?: (moment: HubLivePulseMoment) => void
  format?: HubCardFormatOptions
}

export function HubIntervalSection(_props: HubIntervalSectionProps): null {
  return null
}
