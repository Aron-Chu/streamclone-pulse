import { useEffect, useState } from 'react'
import {
  DEFAULT_SUPPORTER_PAINT,
  SUPPORTER_PAINT_KEY,
  normalizeSupporterPaintStyle,
  type SupporterPaintStyle,
} from '../shared/supporterPaint.ts'
import { SUPPORTER_LOOKS_KEY, SUPPORTER_MOTIONS, normalizeSupporterLooks, type SupporterLook, type SupporterMotion } from '../shared/supporterLook.ts'
import { getSupporterLooks, getSupporterPaintStyle, setSupporterLooks, setSupporterPaintStyle } from '../shared/storage.ts'
import type { SupporterFinishId } from '../ui/supporterFinish.ts'

/**
 * The profile's paint motion (stored as wave and sheen). Your look writes it
 * when a look is equipped; `choose` throws when the write fails so the caller
 * can say so.
 *
 * Unlike the finish, it is not checked by the server: it only describes how a
 * verified finish moves, so choosing it unlocks nothing.
 */
export function useSupporterPaintStyle() {
  const [style, setStyle] = useState<SupporterPaintStyle>(DEFAULT_SUPPORTER_PAINT)
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
    await setSupporterPaintStyle(next)
  }
  return { style, choose }
}

/** A Supporter's saved looks, synced with their other settings. `write` throws when the write fails. */
export function useSavedLooks() {
  const [looks, setLooks] = useState<SupporterLook[]>([])
  useEffect(() => {
    let alive = true
    void getSupporterLooks().then(next => { if (alive) setLooks(next) }).catch(() => { /* None shown. */ })
    const changes = globalThis.chrome?.storage?.onChanged
    const listener = (items: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'sync' && items[SUPPORTER_LOOKS_KEY]) setLooks(normalizeSupporterLooks(items[SUPPORTER_LOOKS_KEY].newValue))
    }
    changes?.addListener(listener)
    return () => { alive = false; changes?.removeListener(listener) }
  }, [])
  async function write(next: SupporterLook[]) {
    const previous = looks
    setLooks(normalizeSupporterLooks(next))
    try {
      await setSupporterLooks(next)
    } catch (error) {
      setLooks(previous)
      throw error
    }
  }
  return { looks, write }
}

/**
 * Motion: one choice for how the paint moves (and whether the backdrop
 * drifts). Each pill carries a live sample in the paint being tried; under
 * reduced motion everything shows still, and the row says so.
 */
export function SupporterMotionField({ motion, finish, onChoose, disabled = false }: {
  motion: SupporterMotion
  finish: SupporterFinishId | null
  onChoose: (next: SupporterMotion) => void
  disabled?: boolean
}) {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return <fieldset className="pulse-supporter-look-row" disabled={disabled}><legend>Motion</legend>
    <div>
      <div className="pulse-supporter-tiles">
        {SUPPORTER_MOTIONS.map(option => <label key={option.id} className="pulse-supporter-tile" title={option.description}>
          <input
            type="radio"
            name="supporter-motion"
            value={`motion-${option.id}`}
            aria-label={`${option.label} motion`}
            checked={motion === option.id}
            onChange={() => onChoose(option.id)}
          />
          {finish
            ? <b className="pulse-paint pulse-supporter-motion-sample" data-finish={finish} data-wave={option.paint.wave} data-sheen={option.paint.sheen} data-text="Aa" aria-hidden="true">Aa</b>
            : null}
          <small>{option.label}</small>
        </label>)}
      </div>
      {reduced ? <p className="pulse-supporter-detail" data-supporter-reduced-motion>Your system asks for less motion, so every look shows still here.</p> : null}
    </div>
  </fieldset>
}
