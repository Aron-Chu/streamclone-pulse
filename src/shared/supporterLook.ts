import type { PulseBannerPreference } from './storage.ts'
import type { SupporterPaintStyle } from './supporterPaint.ts'

/**
 * A Supporter look: paint, motion and backdrop, chosen and equipped together.
 *
 * Motion is one choice over the stored wave and sheen, so the chat badge and
 * older builds keep reading the values they know. Still also stills the
 * backdrop; Shimmer and Drift let it drift. The crest is earned, never part of
 * a look.
 */
export type SupporterMotion = 'still' | 'shimmer' | 'drift'
export type SupporterLookFinish = 'glass' | 'etched' | 'halo' | null
export type SupporterLookExtras = { motion: SupporterMotion; backdrop: boolean; intensity: number }
export type SupporterLook = SupporterLookExtras & { finish: SupporterLookFinish }

export const SUPPORTER_MOTIONS: ReadonlyArray<{ id: SupporterMotion; label: string; description: string; paint: SupporterPaintStyle }> = [
  { id: 'still', label: 'Still', description: 'Nothing moves', paint: { wave: 'smooth', sheen: 'none' } },
  { id: 'shimmer', label: 'Shimmer', description: 'A light sweeps across now and then', paint: { wave: 'smooth', sheen: 'sweep' } },
  { id: 'drift', label: 'Drift', description: 'The colours drift slowly', paint: { wave: 'aurora', sheen: 'glint' } },
]

/** Older wave and sheen pairs read as the nearest motion. */
export function motionOf(style: SupporterPaintStyle): SupporterMotion {
  return style.sheen === 'none' ? 'still' : style.wave === 'aurora' ? 'drift' : 'shimmer'
}

export function motionPaint(motion: SupporterMotion): SupporterPaintStyle {
  return (SUPPORTER_MOTIONS.find(option => option.id === motion) ?? SUPPORTER_MOTIONS[1]).paint
}

/** The stored backdrop for a look, keeping the panel title. */
export function lookBanner(extras: SupporterLookExtras, title: string): PulseBannerPreference {
  return { mode: !extras.backdrop ? 'off' : extras.motion === 'still' ? 'still' : 'rain', intensity: extras.intensity, title }
}

export function lookExtras(paint: SupporterPaintStyle, banner: PulseBannerPreference): SupporterLookExtras {
  return { motion: motionOf(paint), backdrop: banner.mode !== 'off', intensity: banner.intensity }
}

export function sameExtras(a: SupporterLookExtras, b: SupporterLookExtras): boolean {
  return a.motion === b.motion && a.backdrop === b.backdrop && (!a.backdrop || a.intensity === b.intensity)
}

export function sameLook(a: SupporterLook, b: SupporterLook): boolean {
  return a.finish === b.finish && sameExtras(a, b)
}

/** Ready-made looks anyone can try. Gold leaf is the sample a visitor starts on. */
export const STARTER_LOOKS: ReadonlyArray<{ name: string; look: SupporterLook }> = [
  { name: 'Gold leaf', look: { finish: 'etched', motion: 'drift', backdrop: true, intensity: 40 } },
  { name: 'Signal', look: { finish: 'glass', motion: 'shimmer', backdrop: true, intensity: 35 } },
  { name: 'Bloom', look: { finish: 'halo', motion: 'still', backdrop: true, intensity: 30 } },
  { name: 'Quiet', look: { finish: null, motion: 'still', backdrop: false, intensity: 35 } },
]
export const SAMPLE_LOOK: SupporterLook = STARTER_LOOKS[0].look

const FINISH_LABELS = { glass: 'Glass', etched: 'Etched', halo: 'Halo' } as const

/** A starter's name, or the look described by its paint and motion. */
export function lookName(look: SupporterLook): string {
  const starter = STARTER_LOOKS.find(option => sameLook(option.look, look))
  if (starter) return starter.name
  const motion = SUPPORTER_MOTIONS.find(option => option.id === look.motion)?.label ?? 'Shimmer'
  return `${look.finish ? FINISH_LABELS[look.finish] : 'Default'} · ${motion}${look.backdrop ? '' : ' · no backdrop'}`
}

export const SUPPORTER_LOOKS_KEY = 'supporterLooks'
export const MAX_SAVED_LOOKS = 4

export function normalizeSupporterLooks(value: unknown): SupporterLook[] {
  if (!Array.isArray(value)) return []
  const looks: SupporterLook[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const finish = item.finish === 'glass' || item.finish === 'etched' || item.finish === 'halo' ? item.finish : null
    const motion = item.motion === 'still' || item.motion === 'shimmer' || item.motion === 'drift' ? item.motion : 'shimmer'
    const intensity = typeof item.intensity === 'number' && Number.isFinite(item.intensity) ? Math.min(70, Math.max(10, Math.round(item.intensity / 5) * 5)) : 35
    const look: SupporterLook = { finish, motion, backdrop: item.backdrop === true, intensity }
    if (!looks.some(existing => sameLook(existing, look))) looks.push(look)
    if (looks.length === MAX_SAVED_LOOKS) break
  }
  return looks
}
