import { useEffect, useState } from 'react'
import {
  DEFAULT_SUPPORTER_PAINT,
  SUPPORTER_PAINT_KEY,
  SUPPORTER_SHEEN_OPTIONS,
  SUPPORTER_WAVE_OPTIONS,
  normalizeSupporterPaintStyle,
  type SupporterPaintStyle,
} from '../shared/supporterPaint.ts'
import { getSupporterPaintStyle, setSupporterPaintStyle } from '../shared/storage.ts'
import type { SupporterFinishId } from '../ui/supporterFinish.ts'

/**
 * The profile's wave and sheen, saved as soon as they change.
 *
 * Unlike the finish, these are not checked by the server: they only describe
 * how a verified finish moves, so choosing them unlocks nothing.
 */
export function useSupporterPaintStyle() {
  const [style, setStyle] = useState<SupporterPaintStyle>(DEFAULT_SUPPORTER_PAINT)
  const [status, setStatus] = useState('')
  useEffect(() => {
    let alive = true
    void getSupporterPaintStyle().then(next => { if (alive) setStyle(next) }).catch(() => { /* Keep the default. */ })
    const changes = globalThis.chrome?.storage?.onChanged
    const listener = (items: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'sync' && items[SUPPORTER_PAINT_KEY]) setStyle(normalizeSupporterPaintStyle(items[SUPPORTER_PAINT_KEY].newValue))
    }
    changes?.addListener(listener)
    return () => { alive = false; changes?.removeListener(listener) }
  }, [])
  async function choose(next: SupporterPaintStyle) {
    setStyle(next)
    setStatus('')
    try {
      await setSupporterPaintStyle(next)
      setStatus('Wave and sheen saved.')
    } catch {
      setStatus('Could not save wave and sheen. Please try again.')
    }
  }
  return { style, status, choose }
}

/** Wave and sheen pickers. Each choice previews itself in the selected finish. */
export function SupporterPaintStyleFields({ finish, style, onChoose }: {
  finish: SupporterFinishId | null
  style: SupporterPaintStyle
  onChoose: (next: SupporterPaintStyle) => void
}) {
  const sample = finish ?? 'glass'
  return <>
    <fieldset className="pulse-supporter-badge-choices pulse-supporter-paint-choices"><legend>Wave</legend>
      {SUPPORTER_WAVE_OPTIONS.map(option => <label key={option.id} title={option.description}>
        <input
          type="radio"
          name="supporter-wave"
          value={`wave-${option.id}`}
          aria-label={`${option.label} wave`}
          checked={style.wave === option.id}
          onChange={() => onChoose({ ...style, wave: option.id })}
        />
        <span className="pulse-paint pulse-supporter-paint-sample" data-finish={sample} data-wave={option.id} data-sheen="none" data-text="Aa" aria-hidden="true">Aa</span>
        <span className="pulse-supporter-finish-choice"><strong>{option.label}</strong><small>{option.description}</small></span>
      </label>)}
    </fieldset>
    <fieldset className="pulse-supporter-badge-choices pulse-supporter-paint-choices"><legend>Sheen</legend>
      {SUPPORTER_SHEEN_OPTIONS.map(option => <label key={option.id} title={option.description}>
        <input
          type="radio"
          name="supporter-sheen"
          value={`sheen-${option.id}`}
          aria-label={`${option.label} sheen`}
          checked={style.sheen === option.id}
          onChange={() => onChoose({ ...style, sheen: option.id })}
        />
        <span className="pulse-paint pulse-supporter-paint-sample" data-finish={sample} data-wave={style.wave} data-sheen={option.id} data-text="Aa" aria-hidden="true">Aa</span>
        <span className="pulse-supporter-finish-choice"><strong>{option.label}</strong><small>{option.description}</small></span>
      </label>)}
    </fieldset>
  </>
}
