/**
 * The hub's two pieces of the analytics top bar (11-01 board). The docked search: once the hero's
 * search has scrolled under the bar, the bar shows its own box with the same typed text (from
 * 1100 px a field between the links and the buttons, narrower a search button that opens a full row
 * under the bar). It stays while you type in it. The install button: hidden while the hero's
 * install card is on screen, so the page shows one at a time.
 */
import { useEffect, useRef, useState } from 'react'
import type { HubLiveChannel } from '../../../../lib/publicHub'
import { InstallCta } from '../../InstallCta'
import { HubV5Icon } from './HubV5Icon'
import { HubV5SearchBox } from './HubV5SearchBox'
import { useHubV5Search, useHubV5SearchStore } from './hubV5SearchStore'

const LEAVE_MS = 200

export function HubV5DockSearch({ live }: { live: readonly HubLiveChannel[] }) {
  const store = useHubV5SearchStore()
  const docked = useHubV5Search((s) => s.docked)
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const blurTimer = useRef<number | undefined>(undefined)
  const shown = docked || focused

  useEffect(() => {
    store.inputs.openDock = () => setOpen(true)
    return () => {
      store.inputs.openDock = null
      window.clearTimeout(blurTimer.current)
    }
  }, [store])

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
        aria-label="Search channels"
        aria-expanded={open}
        hidden={!docked}
        onClick={() => {
          if (!open) setOpen(true)
          else store.inputs.dock?.focus()
        }}
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
        <HubV5SearchBox live={live} variant="dock" />
      </div>
    </>
  )
}

export function HubV5BarInstall() {
  const promoVisible = useHubV5Search((s) => s.promoVisible)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.inert = promoVisible
  }, [promoVisible])
  return (
    <span ref={ref} className="hv5-bar-install" data-hidden={promoVisible ? '' : undefined}>
      <InstallCta className="analytics-topnav__install" label="short" icon="mark" data-cta="chrome-install-analytics" />
    </span>
  )
}
