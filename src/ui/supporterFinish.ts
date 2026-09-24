/**
 * A Supporter finish colours the small Pulse signature beside the title.
 *
 * It deliberately carries no background and no shadow. An earlier version
 * repainted the header plate (#172c32 / #292a2b / #302936) while the panel body
 * stayed #202024, so a Supporter's header detached from the panel beneath it and
 * read as a rendering fault rather than as recognition.
 */
export type SupporterFinishId = 'glass' | 'etched' | 'halo'

/** Brand Peak teal — the stroke when no finish is equipped. */
export const PEAK_STROKE = '#2dd4bf'

export const supporterFinish: Record<SupporterFinishId, string> = {
  glass: '#78dce8',
  etched: '#efc96a',
  halo: '#e6a9d6',
}

export const SUPPORTER_FINISH_IDS = ['glass', 'etched', 'halo'] as const

export const SUPPORTER_FINISH_OPTIONS = [
  {
    id: 'glass',
    label: 'Glass',
    description: 'Cool cyan',
  },
  {
    id: 'etched',
    label: 'Etched',
    description: 'Warm gold',
  },
  {
    id: 'halo',
    label: 'Halo',
    description: 'Soft rose',
  },
] as const satisfies ReadonlyArray<{
  id: SupporterFinishId
  label: string
  description: string
}>

export function finishStroke(finish: SupporterFinishId | null | undefined): string {
  return finish ? supporterFinish[finish] : PEAK_STROKE
}
