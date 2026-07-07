import type { Ref } from 'react'
import type { ExtModel } from './landingData'
import { findLandingEmote, landingEmoteImageUrl, type LandingEmote } from './landingEmotes'

export type ExtTheme = 'aurora' | 'volt' | 'azure' | 'aqua'
export type SidebarDemoTab = 'chat' | 'pulse'

interface ExtensionDemoCardProps {
  model?: ExtModel
  theme?: ExtTheme
  scrollportRef?: Ref<HTMLDivElement>
  activeTab?: SidebarDemoTab
  onTabChange?: (tab: SidebarDemoTab) => void
  /** Render only the tab row (for chat mode shell). */
  tabsOnly?: boolean
  /** Show page-scroll tour hint (desktop animated mode). */
  showTourHint?: boolean
}

const CHART_W = 600
const CHART_H = 100
const CHART_PAD = 8
const CHART_CEIL = 44

function chartPoint(value: number, index: number, count: number): readonly [number, number] {
  const x = Math.round((index / Math.max(1, count - 1)) * CHART_W)
  const norm = Math.min(Math.max(value, 0), CHART_CEIL) / CHART_CEIL
  const y = Math.round(CHART_H - CHART_PAD - norm * (CHART_H - CHART_PAD * 2))
  return [x, y] as const
}

function chartLine(values: number[]): string {
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${chartPoint(v, i, values.length).join(',')}`)
    .join(' ')
}

function chartBand(hi: number[], lo: number[]): string {
  const top = chartLine(hi)
  const bottom = lo
    .map((v, i) => chartPoint(v, i, lo.length))
    .reverse()
    .map(([x, y]) => `L${x},${y}`)
    .join(' ')
  return `${top} ${bottom} Z`
}

const CHAT_AVG = [11, 14, 12, 16, 13, 19, 15, 12, 23, 18, 14, 27, 20, 16, 30, 22, 17, 25, 20, 15, 28, 21, 17, 14]
const CHAT_MAX = CHAT_AVG.map((v) => Math.round(v * 1.4))
const CHAT_MIN = CHAT_AVG.map((v) => Math.round(v * 0.58))
const SEVENTV = [4, 6, 5, 8, 6, 10, 7, 5, 12, 9, 6, 14, 10, 7, 16, 11, 8, 13, 10, 6, 15, 11, 8, 6]

const CHAT_LINE = chartLine(CHAT_AVG)
const CHAT_BAND = chartBand(CHAT_MAX, CHAT_MIN)
const SV_LINE = chartLine(SEVENTV)
const SV_AREA = `${SV_LINE} L${CHART_W},${CHART_H} L0,${CHART_H} Z`

const TOP_EMOTES: ReadonlyArray<{ name: string; count: number; emote: LandingEmote; pct: number }> = [
  { name: 'widespeedlaugh', count: 37, emote: findLandingEmote('widespeedlaugh')!, pct: 100 },
  { name: 'degloved', count: 28, emote: findLandingEmote('degloved')!, pct: 76 },
  { name: 'widereacting', count: 21, emote: findLandingEmote('widereacting')!, pct: 57 },
  { name: 'peepoHappy', count: 17, emote: findLandingEmote('peepoHappy')!, pct: 46 },
  { name: 'forsenPls', count: 12, emote: findLandingEmote('forsenPls')!, pct: 32 },
  { name: 'Kappa', count: 9, emote: findLandingEmote('Kappa')!, pct: 24 },
]

const TOP_MOMENT_THUMBS = [
  findLandingEmote('widespeedlaugh')!,
  findLandingEmote('degloved')!,
  findLandingEmote('widereacting')!,
]

const MORE_SPIKES: ReadonlyArray<{ time: string; kind: string; stats: string; emotes: LandingEmote[] }> = [
  {
    time: '00:42:00',
    kind: '7TV emote spike',
    stats: '52 chat - 45 emotes - score 37',
    emotes: [findLandingEmote('widespeedlaugh')!, findLandingEmote('degloved')!, findLandingEmote('Clap')!],
  },
  {
    time: '00:14:00',
    kind: '7TV emote spike',
    stats: '22 chat - 17 emotes - score 33',
    emotes: [findLandingEmote('widereacting')!, findLandingEmote('PepePls')!],
  },
]

const PAST_VODS: ReadonlyArray<{ title: string; date: string; len: string; status: string }> = [
  { title: 'Rank grind + patch notes', date: 'Apr 12', len: '4:22', status: 'Synced' },
  { title: 'Scrim block w/ chat Q&A', date: 'Apr 9', len: '2:18', status: 'Stats' },
  { title: 'Community games night', date: 'Apr 5', len: '3:41', status: 'Synced' },
]

const ICON_VIEWERS = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="5" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M3 13c0-2.5 2.2-4 5-4s5 1.5 5 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)
const ICON_CHAT = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M2.5 3.5h11v7h-6l-3 2.5V10.5h-2z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
)
const ICON_EMOTE = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="6" cy="7" r="0.9" fill="currentColor" />
    <circle cx="10" cy="7" r="0.9" fill="currentColor" />
    <path
      d="M5.5 10c.7.9 1.6 1.3 2.5 1.3s1.8-.4 2.5-1.3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
)

function DemoTabRow({
  activeTab,
  onTabChange,
}: {
  activeTab: SidebarDemoTab
  onTabChange?: (tab: SidebarDemoTab) => void
}) {
  return (
    <div className="sl-ext__tabs" role="tablist" aria-label="Chat or Pulse">
      <span className="sl-ext__tabic" aria-hidden="true">
        ▣
      </span>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'chat'}
        className={`sl-ext__tab${activeTab === 'chat' ? ' is-active' : ''}`}
        onClick={() => onTabChange?.('chat')}
      >
        Chat
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'pulse'}
        className={`sl-ext__tab${activeTab === 'pulse' ? ' is-active' : ''}`}
        onClick={() => onTabChange?.('pulse')}
      >
        Pulse
      </button>
      <span className="sl-ext__tabic" aria-hidden="true">
        ⚙
      </span>
      <span className="sl-ext__tabic" aria-hidden="true">
        ☰
      </span>
    </div>
  )
}

export function ExtensionDemoCard({
  model,
  theme = 'aurora',
  scrollportRef,
  activeTab = 'pulse',
  onTabChange,
  tabsOnly = false,
  showTourHint = false,
}: ExtensionDemoCardProps) {
  const ext = model ?? {
    channel: 'the channel',
    category: 'Just Chatting',
    connectionOk: true,
    syncLabel: 'syncing',
    tiles: [
      { label: 'Viewers', value: '351', sub: '+17 - 5m' },
      { label: 'Chat/min', value: '13', sub: '11.6 avg - 5m' },
      { label: '7TV/min', value: '11', sub: '7TV share 84%' },
    ],
    wavePath: CHAT_LINE,
    reacted: [],
  }
  const channel = ext.channel
  const viewerTile = ext.tiles[0] ?? { label: 'Viewers', value: '351', sub: '+17 - 5m' }
  const chatTile = ext.tiles[1] ?? { label: 'Chat/min', value: '13', sub: '11.6 avg - 5m' }
  const tvTile = ext.tiles[2] ?? { label: '7TV/min', value: '11', sub: '7TV share 84%' }
  const synced = ext.syncLabel === 'syncing'
  const syncPill = synced ? 'Synced' : ext.syncLabel

  if (tabsOnly) {
    return (
      <div className="sl-ext sl-ext--tabs-only" data-theme={theme}>
        <DemoTabRow activeTab={activeTab} onTabChange={onTabChange} />
      </div>
    )
  }

  return (
    <div
      className="sl-ext"
      data-theme={theme}
      role="img"
      aria-label={`StreamPulse Pulse panel for ${channel} with live data coverage, viewer and chat KPIs, Stream Activity chart, top emotes, most reacted moments, and past VODs`}
    >
      <DemoTabRow activeTab={activeTab} onTabChange={onTabChange} />

      <div className="sl-ext__fixed">
        <div className="sl-ext__head">
          <span className="sl-ext__title">
            Stream <span>Pulse</span>
          </span>
          <span className="sl-ext__live">
            <span className="sl-dot" aria-hidden="true" />
            Live
          </span>
        </div>
        <div className="sl-ext__sub">based on chat and emote activity</div>
        <div className="sl-ext__trackbtn" aria-hidden="true">
          Tracking {channel}
        </div>
        <div className="sl-ext__autorow">
          <span>Auto-updating</span>
          <span className="sl-toggle sl-toggle--accent on" aria-hidden="true" />
        </div>
      </div>

      <div className="sl-ext__scrollport" ref={scrollportRef}>
        <div className="sl-ext__scroll">
          <div className="sl-ext__card" data-tour-step="1">
            <div className="sl-ext__cardh">
              <span>Live now</span>
              <span className={`sl-pill ${synced ? 'ok' : 'warn'}`}>{syncPill}</span>
            </div>
            <div className="sl-ln-grid">
              <div className="sl-ln-tile">
                <small>{ICON_VIEWERS} {viewerTile.label}</small>
                <b>{viewerTile.value}</b>
                <span className={viewerTile.sub.startsWith('-') ? 'dn' : 'up'}>{viewerTile.sub}</span>
              </div>
              <div className="sl-ln-tile">
                <small>{ICON_CHAT} {chatTile.label}</small>
                <b>
                  {chatTile.value} <i className="sl-ln-trend">▲</i>
                </b>
                <span className="meta">{chatTile.sub}</span>
              </div>
              <div className="sl-ln-tile">
                <small>{ICON_EMOTE} {tvTile.label}</small>
                <b>{tvTile.value}</b>
                <span className="meta">{tvTile.sub}</span>
              </div>
            </div>
          </div>

          <div className="sl-ext__card" data-tour-step="2">
            <div className="sl-ext__cardh">
              <span>Stream Activity</span>
            </div>
            <div className="sl-ext__hint">chat, viewers, emotes - stream time</div>
            <div className="sl-segpair sl-segpair--wide" aria-hidden="true">
              <i className="is-active">60M</i>
              <i>4H</i>
              <i>Full</i>
            </div>
            <div className="sl-xlegend2" aria-hidden="true">
              <span>
                <i className="chat" />Chat/min
              </span>
              <span>
                <i className="band" />min-max
              </span>
              <span>
                <i className="sv" />7TV/min
              </span>
            </div>
            <div className="sl-plotrow" aria-hidden="true">
              <span className="sl-plotrow__label">Plot on chart (0-4)</span>
              {TOP_EMOTES.slice(0, 4).map((emote, index) => (
                <span className={`sl-plotchip${index === 0 ? ' is-active' : ''}`} key={emote.name}>
                  <img src={landingEmoteImageUrl(emote.emote, '1x')} alt="" loading="lazy" decoding="async" />
                  <span>{emote.name}</span>
                </span>
              ))}
            </div>
            <div className="sl-xchart2" aria-hidden="true">
              <svg viewBox="0 0 600 100" preserveAspectRatio="none">
                <path d={CHAT_BAND} className="sl-xc-chatband" />
                <path d={SV_AREA} className="sl-xc-area" />
                <path d={SV_LINE} className="sl-xc-sv" vectorEffect="non-scaling-stroke" />
                <path d={CHAT_LINE} className="sl-xc-chat" vectorEffect="non-scaling-stroke" />
              </svg>
              <span className="sl-xchart__now" />
            </div>
            <div className="sl-ext__axis" aria-hidden="true">
              <span>00:38:00</span>
              <span>01:07:00</span>
              <span>Now</span>
            </div>
            <div className="sl-gamebands" aria-hidden="true">
              <span>Just Chatting</span>
              <span>Fortnite</span>
            </div>

            <div className="sl-te__head">
              <span>Top emotes</span>
              <span className="sl-te__count">6 / 19</span>
            </div>
            <div className="sl-te">
              {TOP_EMOTES.map((emote, index) => (
                <div className={`sl-te__row${index === 0 ? ' is-hot' : ''}`} key={emote.name}>
                  <span className="sl-te__rank">{index + 1}</span>
                  <img
                    className="sl-te__img"
                    src={landingEmoteImageUrl(emote.emote, '1x')}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="sl-te__name">{emote.name}</span>
                  <span className="sl-te__bar">
                    <i style={{ width: `${emote.pct}%` }} />
                  </span>
                  <span className="sl-te__n">{emote.count}</span>
                </div>
              ))}
            </div>
            <div className="sl-te__all" aria-hidden="true">
              Show all 19
            </div>
            <div className="sl-te__stale" aria-hidden="true">
              7TV stale - using cached set
            </div>
          </div>

          <div className="sl-ext__card sl-cov" data-tour-step="3">
            <div className="sl-cov__head">
              <span className="sl-cov__k">Data coverage</span>
              <span className={`sl-cov__live${synced ? '' : ' is-waiting'}`}>
                <span className="sl-dot" aria-hidden="true" />
                {synced ? 'Live analytics active' : 'Stats-only until chat sync'}
              </span>
            </div>
            <p className="sl-cov__copy">
              Live chat and emote rollups update each minute, with the visible coverage window reported by the backend.
            </p>
            <div className="sl-cov__rows">
              <div>
                <span>Viewer source</span>
                <b>live rollups</b>
              </div>
              <div>
                <span>Coverage start</span>
                <b>+1:42</b>
              </div>
              <div>
                <span>Live window</span>
                <b>1:42:18</b>
              </div>
            </div>
            <div className="sl-cov__note">Late-start windows stay visible; StreamPulse does not fabricate earlier chat.</div>
          </div>

          <div className="sl-ext__card" data-tour-step="4">
            <div className="sl-ext__cardh">
              <span>Most Reacted So Far</span>
            </div>
            <div className="sl-ext__hint">
              Top backend-detected moment from chat, viewer, and emote signals.
            </div>
            <div className="sl-mrhero">
              <div className="sl-mrhero__top">
                <span className="sl-mrhero__badge">Top moment</span>
                <span className="sl-mrhero__time">00:18:42</span>
                <span className="sl-mrhero__score">
                  <b>61</b>
                  <small>score</small>
                </span>
              </div>
              <div className="sl-mrhero__reason">Chat spike</div>
              <div className="sl-mrhero__metrics">
                <span>
                  <b>827</b> chat max
                </span>
                <span>
                  <b>530</b> emote peak
                </span>
              </div>
              <div className="sl-mrhero__thumbs" aria-hidden="true">
                {TOP_MOMENT_THUMBS.map((emote) => (
                  <img key={emote.id} src={landingEmoteImageUrl(emote, '1x')} alt="" loading="lazy" decoding="async" />
                ))}
                <span className="sl-mrhero__w">W</span>
              </div>
              <div className="sl-mrhero__btns">
                <span className="sl-mrhero__btn">Jump to moment</span>
                <span className="sl-mrhero__btn ghost">Analytics</span>
              </div>
            </div>
            <div className="sl-mr-cap">More spikes</div>
            <div className="sl-mr">
              {MORE_SPIKES.map((spike) => (
                <div className="sl-mr-row sl-mr-row--rich" key={spike.time}>
                  <span className="t">{spike.time}</span>
                  <span className="s2">
                    <b>{spike.kind}</b>
                    <small>{spike.stats}</small>
                  </span>
                  <span className="sl-mr-row__emos" aria-hidden="true">
                    {spike.emotes.map((emote) => (
                      <img key={emote.id} src={landingEmoteImageUrl(emote, '1x')} alt="" loading="lazy" decoding="async" />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="sl-ext__card" data-tour-step="5">
            <div className="sl-ext__cardh">
              <span>Past streams</span>
              <span className="sl-pv__count">3</span>
            </div>
            <div className="sl-ext__hint">Ended broadcasts with sync status and one-tap analytics.</div>
            <div className="sl-pv__list" aria-hidden="true">
              {PAST_VODS.map((vod) => (
                <div className="sl-pv__row" key={vod.title}>
                  <span className="sl-pv__thumb">
                    <span className="sl-pv__len">{vod.len}</span>
                  </span>
                  <span className="sl-pv__meta">
                    <span className="sl-pv__title">{vod.title}</span>
                    <span className="sl-pv__date">{vod.date}</span>
                  </span>
                  <span className="sl-pv__status">{vod.status}</span>
                </div>
              ))}
            </div>
            <div className="sl-pv__foot" aria-hidden="true">
              View all past streams
            </div>
          </div>
        </div>
      </div>
      {showTourHint ? (
        <p className="sl-ext__scrollhint" aria-hidden="true">
          Scroll the page to tour each card
        </p>
      ) : null}
    </div>
  )
}