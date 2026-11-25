/**
 * The hub's two pieces of the analytics top bar (11-01 board). The docked search: once the hero's
 * search has scrolled under the bar, the bar shows its own box with the same typed text (from
 * 1100 px a field on the bar's middle between the links and the buttons, narrower a search button
 * that opens a full row under the bar). It stays while you type in it. The front page's header
 * docks the same box (Landing). The install button: hidden while the hero's install card is on
 * screen, so the page shows one at a time.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { HubLiveChannel } from '../../../../lib/publicHub'
import { InstallCta } from '../../InstallCta'
import { SiteHeaderStepBack } from '../../SiteHeader'
import { HubV5Icon } from './HubV5Icon'
import { HubV5SearchBox } from './HubV5SearchBox'
import type { HubSearchEmote, HubSearchGame } from './hubV5Model'
import { useHubV5Search, useHubV5SearchStore } from './hubV5SearchStore'

const LEAVE_MS = 200

/** The bar the dock sits in: its parent, past a wrapper that only groups (display: contents, as the front page's). */
function barOf(slot: HTMLElement): HTMLElement | null {
  let bar = slot.parentElement
  while (bar && getComputedStyle(bar).display === 'contents') bar = bar.parentElement
  return bar
}

/**
 * The field on the bar's middle (11-18). Its slot is the room between the links and the buttons,
 * which is rarely centred, so the field moves toward the bar's centre line as far as the slot
 * allows, and sits right on it where the bar is wide enough. Written as --hv5-dock-shift on the
 * slot; the bars' CSS applies it. A full-width row has no room to move, so it reads 0 there.
 */
function useBarCentre(slotRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const slot = slotRef.current
    const bar = slot ? barOf(slot) : null
    if (!slot || !bar) return undefined
    const place = () => {
      const field = slot.firstElementChild
      if (!(field instanceof HTMLElement)) return
      const b = bar.getBoundingClientRect()
      const s = slot.getBoundingClientRect()
      const room = Math.max(0, (s.width - field.offsetWidth) / 2)
      const want = b.left + b.width / 2 - (s.left + s.width / 2)
      slot.style.setProperty('--hv5-dock-shift', `${Math.round(Math.max(-room, Math.min(room, want)))}px`)
    }
    place()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(place)
    ro.observe(bar)
    ro.observe(slot)
    return () => ro.disconnect()
  }, [slotRef])
}

export function HubV5DockSearch({ live, games, emotes }: { live: readonly HubLiveChannel[]; games?: readonly HubSearchGame[]; emotes?: readonly HubSearchEmote[] }) {
  const store = useHubV5SearchStore()
  const docked = useHubV5Search((s) => s.docked)
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 719px)').matches)
  const fieldRef = useRef<HTMLDivElement>(null)
  const blurTimer = useRef<number | undefined>(undefined)
  const shown = docked || focused
  useBarCentre(fieldRef)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(max-width: 719px)')
    const update = () => setPhone(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const openSearch = useCallback(() => {
    if (phone && store.inputs.hero) {
      // The phone bar scrolls away. Its reachable search action returns to
      // the existing field instead of opening a row outside the viewport.
      store.inputs.hero.focus({ preventScroll: true })
      store.inputs.hero.scrollIntoView({ block: 'center', behavior: 'instant' })
    } else if (!open) setOpen(true)
    else store.inputs.dock?.focus()
  }, [phone, store, open])

  useEffect(() => {
    store.inputs.openDock = openSearch
    return () => {
      store.inputs.openDock = null
      window.clearTimeout(blurTimer.current)
    }
  }, [store, openSearch])

  // Scrolled back up: the narrow row closes, unless you're typing in it.
  useEffect(() => {
    if (!docked && !focused) setOpen(false)
  }, [docked, focused])

  useEffect(() => {
    if (fieldRef.current) fieldRef.current.inert = !shown
  }, [shown])

  // The narrow row takes focus as it opens.
  useEffect(() => {
    if (open) store.inputs.dock?.focus()
  }, [open, store])

  return (
    <>
      <button
        type="button"
        className="hv5-dock-btn"
        aria-label="Search streamers or games"
        aria-expanded={phone ? undefined : open}
        hidden={!docked && !phone}
        data-docked={docked ? '' : undefined}
        onClick={openSearch}
      >
        <HubV5Icon name="search" />
      </button>
      <div
        ref={fieldRef}
        className="hv5-dock hv5-layer hub-d3-layer"
        data-shown={shown ? '' : undefined}
        data-open={open ? '' : undefined}
        onFocus={() => {
          window.clearTimeout(blurTimer.current)
          setFocused(true)
        }}
        onBlur={() => {
          // After the list's own close, so a tap on a row still lands.
          window.clearTimeout(blurTimer.current)
          blurTimer.current = window.setTimeout(() => {
            if (fieldRef.current?.contains(document.activeElement)) return
            setFocused(false)
            setOpen(false)
          }, LEAVE_MS)
        }}
      >
        <HubV5SearchBox live={live} variant="dock" games={games} emotes={emotes} />
      </div>
    </>
  )
}

export function HubV5BarInstall() {
  const promoVisible = useHubV5Search((s) => s.promoVisible)
  return (
    <SiteHeaderStepBack hidden={promoVisible}>
      <InstallCta className="site-header__install" label="short" icon="mark" data-cta="chrome-install-analytics" />
    </SiteHeaderStepBack>
  )
}
