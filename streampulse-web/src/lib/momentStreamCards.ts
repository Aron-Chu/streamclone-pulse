import type { DiscoveryMoment } from './discoveryMoments'
import { momentStrength } from './momentsPage'

type GroupedMoment = Pick<DiscoveryMoment, 'key' | 'login' | 'streamId' | 'comparison' | 'chatPerMin' | 'at'>

/** One stream on Latest: the moment its card leads with, and the rest of its moments. */
export interface MomentStream<T> {
  /** The stream's identity: login and broadcast. */
  key: string
  lead: T
  /** The stream's other moments, in the list's order. */
  others: T[]
}

const stronger = (a: GroupedMoment, b: GroupedMoment) => {
  const lift = momentStrength(a) - momentStrength(b)
  // Two rises from a zero average are equally strong (Infinity - Infinity is NaN).
  if (lift && !Number.isNaN(lift)) return lift > 0
  const chat = (a.chatPerMin ?? -1) - (b.chatPerMin ?? -1)
  if (chat) return chat > 0
  return (a.at ?? 0) > (b.at ?? 0)
}

/**
 * Latest as one card per stream (B, 11-22). Each stream leads with its strongest
 * moment: the best ×, then the busier chat, then the newer minute. Streams keep the
 * order the list first names them in, so the list's sort still decides the page.
 */
export function momentStreams<T extends GroupedMoment>(moments: readonly T[]): MomentStream<T>[] {
  const streams = new Map<string, T[]>()
  for (const moment of moments) {
    const key = `${moment.login}|${moment.streamId}`
    const list = streams.get(key)
    if (list) list.push(moment)
    else streams.set(key, [moment])
  }
  return [...streams].map(([key, list]) => {
    const lead = list.reduce((best, moment) => stronger(moment, best) ? moment : best)
    return { key, lead, others: list.filter(moment => moment !== lead) }
  })
}

/**
 * The cards a stream shows: its lead, then every other moment while the reader has
 * opened them. An open moment always keeps its card, so its detail never loses the
 * card it opened under.
 */
export function momentStreamCards<T extends { key: string }>(stream: MomentStream<T>, expanded: boolean, openKey: string | null): T[] {
  if (expanded) return [stream.lead, ...stream.others]
  const open = openKey == null ? undefined : stream.others.find(moment => moment.key === openKey)
  return open ? [stream.lead, open] : [stream.lead]
}
