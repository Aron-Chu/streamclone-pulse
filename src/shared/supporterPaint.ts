/**
 * A Supporter's paint and crest.
 *
 * The finish (Glass, Etched, Halo) is the paint's colour and the server
 * verifies it. Wave and sheen only describe how that paint moves. They are a
 * presentation choice kept in this browser profile's synced settings, never
 * unlock anything, and show only while a verified finish is equipped.
 *
 * The crest follows the support-period count the server reports, so a client
 * cannot raise its own tenure.
 */
export type SupporterWave = 'smooth' | 'ripple' | 'chrome' | 'aurora'
export type SupporterSheen = 'sweep' | 'glint' | 'pulse' | 'none'
export interface SupporterPaintStyle { wave: SupporterWave; sheen: SupporterSheen }

export const SUPPORTER_PAINT_KEY = 'supporterPaintStyle'
export const DEFAULT_SUPPORTER_PAINT: SupporterPaintStyle = { wave: 'smooth', sheen: 'sweep' }

export const SUPPORTER_WAVE_OPTIONS = [
  { id: 'smooth', label: 'Smooth', description: 'One soft blend' },
  { id: 'ripple', label: 'Ripple', description: 'Fine repeating bands' },
  { id: 'chrome', label: 'Chrome', description: 'A polished horizon line' },
  { id: 'aurora', label: 'Aurora', description: 'Colours drift slowly' },
] as const satisfies ReadonlyArray<{ id: SupporterWave; label: string; description: string }>

export const SUPPORTER_SHEEN_OPTIONS = [
  { id: 'sweep', label: 'Sweep', description: 'Light crosses every few seconds' },
  { id: 'glint', label: 'Glint', description: 'A quick flash, then a long rest' },
  { id: 'pulse', label: 'Pulse', description: 'Brightens like a heartbeat' },
  { id: 'none', label: 'None', description: 'No moving light' },
] as const satisfies ReadonlyArray<{ id: SupporterSheen; label: string; description: string }>

export function normalizeSupporterPaintStyle(value: unknown): SupporterPaintStyle {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const wave = SUPPORTER_WAVE_OPTIONS.find(option => option.id === raw.wave)?.id ?? DEFAULT_SUPPORTER_PAINT.wave
  const sheen = SUPPORTER_SHEEN_OPTIONS.find(option => option.id === raw.sheen)?.id ?? DEFAULT_SUPPORTER_PAINT.sheen
  return { wave, sheen }
}

export type SupporterTenure = 'new' | '3m' | '6m' | '12m' | '24m'
export const SUPPORTER_TENURES = [
  { id: 'new', months: 0, label: 'New' },
  { id: '3m', months: 3, label: '3 months' },
  { id: '6m', months: 6, label: '6 months' },
  { id: '12m', months: 12, label: '12 months' },
  { id: '24m', months: 24, label: '24 months' },
] as const satisfies ReadonlyArray<{ id: SupporterTenure; months: number; label: string }>

export function supporterTenureForMonths(months: number): SupporterTenure {
  const normalized = Number.isFinite(months) ? Math.max(0, Math.floor(months)) : 0
  let selected: (typeof SUPPORTER_TENURES)[number] = SUPPORTER_TENURES[0]
  for (const option of SUPPORTER_TENURES) {
    if (option.months <= normalized) selected = option
  }
  return selected.id
}

/**
 * Each stage gains a more recognizable silhouette and a rank detail. Shared by
 * the React badge and the stylesheet crest, so both draw the same art.
 */
export const SUPPORTER_CREST_GEMS: Record<SupporterTenure, { edge: string; points: string; rank: string; crown?: string }> = {
  new: { edge: '#55f5c3', points: '4,2 14,2 16,4 16,14 14,16 4,16 2,14 2,4', rank: 'M7 14 H11' },
  '3m': { edge: '#59d9ff', points: '9,1.5 16.5,5 16.5,13 9,16.5 1.5,13 1.5,5', rank: 'M5.5 14 H12.5' },
  '6m': { edge: '#cc9cff', points: '5,1.5 13,1.5 17,7 14,16 4,16 1,7', rank: 'M5 14 H7.5 M10.5 14 H13' },
  '12m': { edge: '#ffe16b', points: '5,3 7,3 9,1 11,3 13,3 17,7 14,16 4,16 1,7', rank: 'M4.5 14 H6 M7.5 14 H10.5 M12 14 H13.5' },
  '24m': { edge: '#ff85be', points: '1.5,5.5 4.5,5.5 5.5,2.5 8,3.5 9,1 10,3.5 12.5,2.5 13.5,5.5 16.5,5.5 15,10 16,13.5 12.5,16.5 5.5,16.5 2,13.5 3,10', rank: 'M4.5 14 H13.5', crown: 'M4.5 5.5 L5.5 2.5 L8 3.5 L9 1 L10 3.5 L12.5 2.5 L13.5 5.5' },
}

export const SUPPORTER_CREST_PULSE_PATH = 'M4.5 10 H6.5 L8 6 L10 11.5 L11.5 8 L13.5 10'

/** The crest as a CSS `url()` value, so the header can show it with no script. */
export function supporterCrestCssUrl(tenure: SupporterTenure): string {
  const gem = SUPPORTER_CREST_GEMS[tenure]
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'>`
    + `<polygon points='${gem.points}' fill='#08080a' stroke='${gem.edge}' stroke-width='1.5' stroke-linejoin='round'/>`
    + (gem.crown ? `<path d='${gem.crown}' fill='none' stroke='#ffe8a6' stroke-width='1.1' stroke-linejoin='round' stroke-linecap='round'/>` : '')
    + `<path d='${gem.rank}' fill='none' stroke='${gem.edge}' stroke-width='1.5' stroke-linecap='round'/>`
    + `<path d='${SUPPORTER_CREST_PULSE_PATH}' fill='none' stroke='#fff' stroke-width='1.75' stroke-linejoin='round' stroke-linecap='round'/>`
    + `</svg>`
  return `url("data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`
}
