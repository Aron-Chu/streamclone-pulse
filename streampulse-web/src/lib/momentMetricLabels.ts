import { compact } from '../ui/components/analytics/hubFormat'

export const REACTION_SCORE_TOOLTIP =
  'Reaction score (0–100): weighted spike strength across chat, emotes, viewers, provider burst, dominance, and novelty.'

export function formatReactionScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return '—'
  return `${Math.round(score)}/100`
}

export function formatChatRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${compact(value)}/min chat`
}

export function formatViewerDelta(delta: number | string | null | undefined): string {
  if (delta == null) return '—'
  if (typeof delta === 'string') {
    const trimmed = delta.trim()
    if (!trimmed) return '—'
    if (/no change/i.test(trimmed)) return trimmed
    if (/viewers/i.test(trimmed)) return trimmed
    const parsed = Number(trimmed.replace(/[^0-9+\-.]/g, ''))
    if (Number.isFinite(parsed)) {
      if (parsed === 0) return 'no change'
      const prefix = parsed > 0 ? '+' : ''
      return `${prefix}${compact(parsed)} viewers`
    }
    return trimmed
  }
  if (delta === 0) return 'no change'
  const prefix = delta > 0 ? '+' : ''
  return `${prefix}${compact(delta)} viewers`
}
