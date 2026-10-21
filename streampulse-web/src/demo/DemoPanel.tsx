// The demo's chrome must be the global before any extension module evaluates.
import { bindDemoPageHooks, demoChrome, demoVodPulse } from './installDemoChrome'
// Catch me up ships as its own content script; on the site it is bundled here.
import '@pulse-ext/content/catchMeUp.ts'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SIDEBAR_COLLAPSED_PILL_HEIGHT, SIDEBAR_MINI_PANEL_HEIGHT } from '@pulse-ext/content/twitchLayout.ts'
import { getThemePreference, themeFromStorageChange } from '@pulse-ext/shared/storage.ts'
import { Overlay } from '@pulse-ext/ui/Overlay.tsx'
import { overlayStyles } from '@pulse-ext/ui/overlayStyles.ts'
import { applyAccentTheme } from '@pulse-ext/ui/overlayTheme.ts'
import { PulsePortalContext } from '@pulse-ext/ui/pulsePortalContext.ts'
import { shadowStyles } from '@pulse-ext/ui/theme.ts'
import { vodPulseToChannelPayload } from '@pulse-ext/vod/vodPulseToChannelPayload.ts'
import { DemoPlayer } from './DemoPlayer'
import { DEMO_CHANNEL, demoLeaveNote, isDemoExitUrl, toSiteUrl } from './demoLinks'
import './demo.css'

type SidebarTab = 'chat' | 'pulse'
type OverlayMode = 'collapsed' | 'mini' | 'expanded'

/**
 * In Twitch the panel's hosts are fixed boxes over the chat column. Here they
 * sit in the demo's own column, so they take the page's flow instead.
 */
const HOST_OVERRIDE = ':host{position:relative;z-index:auto;pointer-events:auto;height:100%}'

/**
 * The site shows no Supporter pieces. The panel's quick settings carry two
 * (the Supporter card and the "Your look" group), so the demo leaves them out.
 */
const NO_SUPPORTER = '.pulse-settings-supporter-cta,.pulse-quick-group:has(.pulse-quick-look){display:none!important}'

const login = demoVodPulse.login ?? DEMO_CHANNEL.login
const vodId = demoVodPulse.vodId ?? ''
const context = { kind: 'vod' as const, login: null, vodId }
// Built before the first render, as the content script does: a payload that
// arrives later trips the panel's load-stall warnings.
const payload = vodPulseToChannelPayload(demoVodPulse, login)
const sessionOpenedAtMs = Date.now()
// A little before the stream's biggest moment, so the panel has history to show.
const START_SECONDS = 47 * 60 + 30

/** Header buttons that work Twitch's own chat column, which the demo doesn't have. */
const TWITCH_CHAT_CONTROLS: ReadonlyMap<string, string> = new Map([
  ['Hide chat panel', 'On Twitch, this folds the chat column away. The demo has no chat column, so it stays as it is.'],
  ['Open chatters list', 'On Twitch, this opens the list of people in chat. The demo has no chat, so there’s no list.'],
])

interface ShadowMount {
  shadow: ShadowRoot
  root: Root
}

function mountShadow(host: HTMLElement): ShadowMount {
  // React's development double-mount reuses the host, which can't take a second shadow root.
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = overlayStyles + shadowStyles + HOST_OVERRIDE + NO_SUPPORTER
  const mountPoint = document.createElement('div')
  mountPoint.className = 'pulse-root'
  shadow.replaceChildren(style, mountPoint)
  return { shadow, root: createRoot(mountPoint) }
}

export default function DemoPanel({ active = true }: { active?: boolean }) {
  const tabsHost = useRef<HTMLDivElement>(null)
  const bodyHost = useRef<HTMLDivElement>(null)
  const column = useRef<HTMLDivElement>(null)
  const [mounts, setMounts] = useState<{ tabs: ShadowMount; body: ShadowMount } | null>(null)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('pulse')
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('expanded')
  const [width, setWidth] = useState(340)
  const [note, setNote] = useState<string | null>(null)

  // Shadow roots and React roots for the two parts, as src/content/mount.tsx makes them.
  useLayoutEffect(() => {
    if (!tabsHost.current || !bodyHost.current) return
    const next = { tabs: mountShadow(tabsHost.current), body: mountShadow(bodyHost.current) }
    setMounts(next)
    return () => {
      setMounts(null)
      // Unmounting during React's own commit warns; let it finish first.
      window.setTimeout(() => {
        next.tabs.root.unmount()
        next.body.root.unmount()
      }, 0)
    }
  }, [])

  // The accent the visitor picks in the panel's settings, as the content script applies it.
  useEffect(() => {
    void getThemePreference().then(applyAccentTheme)
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      const next = area === 'sync' ? themeFromStorageChange(changes) : undefined
      if (next) applyAccentTheme(next)
    }
    demoChrome.storage.onChanged.addListener(onChanged)
    return () => demoChrome.storage.onChanged.removeListener(onChanged)
  }, [])

  // What the extension would open outside the panel.
  useEffect(() => bindDemoPageHooks({
    onOpenSettings: section => setNote(section === 'moments'
      ? 'In the extension, this opens My Moments: the moments you saved and watched. The demo stays here.'
      : 'In the extension, this opens the full settings page. The demo stays here.'),
    onCommunityLink: link => {
      window.open(link === 'discord' ? '/discord' : '/feedback', '_blank', 'noopener,noreferrer')
    },
  }), [])

  // Links to Twitch or to this stream's analytics have nowhere to go: the stream is made up.
  // Links to the site's own pages open on this origin rather than the hosted one.
  // Buttons that work Twitch's chat column say what they do there.
  useEffect(() => {
    if (!mounts) return
    const open = window.open
    const onClick = (event: Event) => {
      const path = event.composedPath()
      const control = path.find(
        (node): node is HTMLButtonElement => node instanceof HTMLButtonElement && TWITCH_CHAT_CONTROLS.has(node.getAttribute('aria-label') ?? ''),
      )
      if (control) {
        setNote(TWITCH_CHAT_CONTROLS.get(control.getAttribute('aria-label') ?? '') ?? null)
        return
      }
      const anchor = path.find(
        (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement && Boolean(node.href),
      )
      if (!anchor) return
      if (isDemoExitUrl(anchor.href)) {
        event.preventDefault()
        setNote(demoLeaveNote(anchor.href))
        return
      }
      const local = toSiteUrl(anchor.href)
      if (local === anchor.href) return
      event.preventDefault()
      open.call(window, local, anchor.target || '_blank', 'noopener,noreferrer')
    }
    const roots = [mounts.tabs.shadow, mounts.body.shadow]
    roots.forEach(root => root.addEventListener('click', onClick, true))
    window.open = function demoOpen(url?: string | URL, target?: string, features?: string) {
      if (url !== undefined && isDemoExitUrl(String(url))) {
        setNote(demoLeaveNote(String(url)))
        return null
      }
      return open.call(window, url === undefined ? url : toSiteUrl(String(url)), target, features)
    }
    return () => {
      roots.forEach(root => root.removeEventListener('click', onClick, true))
      window.open = open
    }
  }, [mounts])

  useEffect(() => {
    if (!note) return
    const timer = window.setTimeout(() => setNote(null), 6000)
    return () => window.clearTimeout(timer)
  }, [note])

  // The panel lays out by its host's width (compact under 360 px).
  useLayoutEffect(() => {
    const el = column.current
    if (!el) return
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const onSidebarTabChange = useCallback((tab: SidebarTab) => setSidebarTab(tab), [])
  const onOverlayModeChange = useCallback((mode: OverlayMode) => setOverlayMode(mode), [])

  useEffect(() => {
    if (!mounts) return
    mounts.tabs.root.render(
      <PulsePortalContext.Provider value={mounts.tabs.shadow}>
        <Overlay
          login={login}
          context={context}
          payload={null}
          effectivePlacement="sidebar"
          sidebarSnapped
          sidebarPart="tabs"
          sidebarTab={sidebarTab}
          overlayMode={overlayMode}
          onSidebarTabChange={onSidebarTabChange}
          onOverlayModeChange={onOverlayModeChange}
        />
      </PulsePortalContext.Provider>,
    )
    mounts.body.root.render(
      <PulsePortalContext.Provider value={mounts.body.shadow}>
        <Overlay
          login={login}
          context={context}
          payload={payload}
          vodPulse={demoVodPulse}
          vodPulseLoading={false}
          pageIsLive={false}
          sessionOpenedAtMs={sessionOpenedAtMs}
          coverageTier={null}
          effectivePlacement="sidebar"
          sidebarSnapped
          sidebarPart="body"
          panelHostWidth={width}
          sidebarTab={sidebarTab}
          overlayMode={overlayMode}
          onSidebarTabChange={onSidebarTabChange}
          onOverlayModeChange={onOverlayModeChange}
        />
      </PulsePortalContext.Provider>,
    )
  }, [mounts, sidebarTab, overlayMode, width, onSidebarTabChange, onOverlayModeChange])

  // Where the panel sits in the chat column, as the content script places it.
  const pulseShown = sidebarTab === 'pulse'
  const dock = !pulseShown
    ? 'hidden'
    : overlayMode === 'collapsed' ? 'collapsed' : overlayMode === 'mini' ? 'mini' : 'expanded'
  const dockHeight = dock === 'collapsed' ? SIDEBAR_COLLAPSED_PILL_HEIGHT : dock === 'mini' ? SIDEBAR_MINI_PANEL_HEIGHT : undefined

  // A hidden panel takes no focus or clicks (React 18 has no `inert` prop).
  useEffect(() => {
    const host = bodyHost.current as (HTMLDivElement & { inert?: boolean }) | null
    if (host) host.inert = dock === 'hidden'
  }, [dock])

  return (
    <div className="xd-stage" data-testid="extension-demo" data-demo-ready={mounts ? '' : undefined}>
      <DemoPlayer
        channelName={DEMO_CHANNEL.name}
        title={demoVodPulse.title ?? ''}
        durationSeconds={demoVodPulse.durationSeconds ?? 0}
        games={demoVodPulse.games ?? []}
        startSeconds={START_SECONDS}
        active={active}
      />
      <div className="xd-side" ref={column} data-dock={dock} data-testid="demo-sidebar">
        <div className="xd-side__header" ref={tabsHost} />
        <div className="xd-side__body">
          {dock !== 'expanded' ? (
            <div className="xd-chat" data-testid="demo-chat-placeholder">
              <p className="xd-chat__title">Twitch chat</p>
              <p>The demo has no chat. On Twitch, the channel&apos;s chat is here and the Pulse tab sits over it.</p>
            </div>
          ) : null}
          <div
            ref={bodyHost}
            className="xd-side__panel"
            data-dock={dock}
            style={dockHeight ? { height: dockHeight } : undefined}
            aria-hidden={dock === 'hidden' ? true : undefined}
          />
        </div>
        {note ? (
          <div className="xd-note" role="status" data-testid="demo-note">
            <span>{note}</span>
            <button type="button" onClick={() => setNote(null)} aria-label="Dismiss">×</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
