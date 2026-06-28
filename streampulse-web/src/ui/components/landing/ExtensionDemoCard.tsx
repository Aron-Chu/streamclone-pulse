import type { Ref } from 'react'
import type { ExtModel } from './landingData'
import { seventvImageUrl } from './landingEmotes'

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
}

/**
 * Deterministic chart geometry. The chat/min line, its min–max band, and the
 * 7TV/min series all share one vertical scale so they stay aligned — mirroring
 * the shipped analytics chart, which overlays a 7TV series on the chat line.
 */
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

/** Top-emote leaderboard — 7TV ids are decorative stand-ins for the channel set. */
const TOP_EMOTES: ReadonlyArray<{ name: string; count: number; id: string; pct: number }> = [
  { name: 'LOL', count: 37, id: '01GAZ199Z8000FEWHS6AT5QZV0', pct: 100 },
  { name: '!join', count: 23, id: '01GB8EQNJ8000497KFBZWNSDFZ', pct: 62 },
  { name: 'LO', count: 17, id: '01G98W833R0000BRQD106P0ZNT', pct: 46 },
  { name: 'aikoL', count: 15, id: '01GB2ZJFBG000DTBJYANG8XYFP', pct: 41 },
  { name: 'classic', count: 10, id: '01GB4P2HX0000BJ5HR8F6XV9Q0', pct: 27 },
  { name: 'clappi', count: 9, id: '01GAM8EFQ00004MXFXAJYKA859', pct: 24 },
]

/** 7TV emote ids used as decorative spike thumbnails. */
const TOP_MOMENT_THUMBS = ['01GB8EQNJ8000497KFBZWNSDFZ', '01GB2ZJFBG000DTBJYANG8XYFP', '01GAZ199Z8000FEWHS6AT5QZV0']

const MORE_SPIKES: ReadonlyArray<{ time: string; kind: string; stats: string; emotes: string[] }> = [
  {
    time: '00:42:00',
    kind: '7TV emote spike',
    stats: '52 chat · 45 emotes · score 37',
    emotes: ['01G98W833R0000BRQD106P0ZNT', '01GB4P2HX0000BJ5HR8F6XV9Q0', '01GAM8EFQ00004MXFXAJYKA859'],
  },
  {
    time: '00:14:00',
    kind: 'Twitch emote spike',
    stats: '22 chat · 17 emotes · score 33',
    emotes: ['01GB2ZJFBG000DTBJYANG8XYFP', '01GAFTZ9K80003DHH026MC7JW0'],
  },
]

/** Past streams — VOD history with per-stream analytics, mirroring the panel's footer card. */
const PAST_VODS: ReadonlyArray<{ title: string; date: string; len: string; status: string; tone: 'live' | 'synced' | 'analytics' }> = [
  { title: 'Subathon finale — day 3', date: 'Live now', len: '1:42', status: 'Live', tone: 'live' },
  { title: 'Ranked grind to top 500', date: 'Yesterday', len: '5:47', status: 'Synced', tone: 'synced' },
  { title: 'Just Chatting + watch party', date: '2 days ago', len: '4:12', status: 'Analytics', tone: 'analytics' },
]

const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5v14l11-7z" fill="currentColor" />
  </svg>
)

/** Tiny line icons for the Live-now tiles, matching the shipped panel. */
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

/**
 * Picture-perfect replica of the shipped StreamPulse "Pulse" panel: the Twitch
 * sidebar tab row, the Stream Pulse header with LIVE badge, tracking button and
 * auto-updating toggle, then a scrolling body with Data coverage, the Live-now
 * KPIs, the 60-minute chat-velocity chart, the Top-emote leaderboard, and the
 * Most-reacted moments. Accent surfaces read from `--xp-*` custom properties
 * keyed by `data-theme`. Decorative (role=img); seeded with the live channel
 * name when present.
 */
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
}: ExtensionDemoCardProps) {
  const channel = model?.channel ?? 'the channel'

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
      aria-label={`StreamPulse Pulse panel for ${channel} — live data coverage, viewer and chat KPIs, the 60-minute chat-velocity chart, the top-emote leaderboard, the most-reacted moments of the stream, and past VODs with full analytics`}
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
          Tracking
        </div>
        <div className="sl-ext__autorow">
          <span>Auto-updating</span>
          <span className="sl-toggle sl-toggle--accent on" aria-hidden="true" />
        </div>
      </div>

      <div className="sl-ext__scrollport" ref={scrollportRef}>
        <div className="sl-ext__scroll">
          {/* Live now — first card so the demo rests on KPIs + chart */}
          <div className="sl-ext__card">
            <div className="sl-ext__cardh">
              <span>Live now</span>
              <span className="sl-pill ok">Synced</span>
            </div>
            <div className="sl-ln-grid">
              <div className="sl-ln-tile">
                <small>{ICON_VIEWERS} Viewers</small>
                <b>351</b>
                <span className="up">+17 · 5m</span>
              </div>
              <div className="sl-ln-tile">
                <small>{ICON_CHAT} Chat / min</small>
                <b>
                  13 <i className="sl-ln-trend">▲</i>
                </b>
                <span className="meta">11.6 avg · 5m</span>
              </div>
              <div className="sl-ln-tile">
                <small>{ICON_EMOTE} Emotes / min</small>
                <b>11</b>
                <span className="meta">
                  <em>7TV</em> 11 · Other 0
                </span>
                <span className="meta2">0 – 7 (5m avg)</span>
              </div>
            </div>
          </div>

          {/* Chat-velocity chart + top emotes */}
          <div className="sl-ext__card">
            <div className="sl-ext__cardh">
              <span>Chat / min (last 60 min)</span>
            </div>
            <div className="sl-ext__hint">stream time · per minute</div>
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
                <i className="band" />min–max
              </span>
              <span>
                <i className="sv" />7TV/min
              </span>
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
                    src={seventvImageUrl(emote.id, '1x')}
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
              7TV stale — using cached set
            </div>
          </div>

          {/* Data coverage */}
          <div className="sl-ext__card sl-cov">
            <div className="sl-cov__head">
              <span className="sl-cov__k">Data coverage</span>
              <span className="sl-cov__live">
                <span className="sl-dot" aria-hidden="true" />
                Live analytics active
              </span>
            </div>
            <p className="sl-cov__copy">
              Live chat and emote rollups are updating each minute from stream start.
            </p>
            <div className="sl-cov__rows">
              <div>
                <span>Stream started</span>
                <b>6/27/2026, 12:02:22 PM</b>
              </div>
              <div>
                <span>Collector attached</span>
                <b>6/27/2026, 12:02:22 PM</b>
              </div>
              <div>
                <span>Metadata</span>
                <b>6/27/2026, 1:40:00 PM</b>
              </div>
            </div>
          </div>

          {/* Most reacted so far */}
          <div className="sl-ext__card">
            <div className="sl-ext__cardh">
              <span>Most reacted so far</span>
            </div>
            <div className="sl-ext__hint">
              Biggest chat &amp; emote spikes this broadcast · updates live as stronger moments land.
            </div>
            <div className="sl-mrhero">
              <div className="sl-mrhero__top">
                <span className="sl-mrhero__badge">Top moment</span>
                <span className="sl-mrhero__time">00:01:00</span>
                <span className="sl-mrhero__score">
                  <b>37</b>
                  <small>score</small>
                </span>
              </div>
              <div className="sl-mrhero__reason">Chat spike</div>
              <div className="sl-mrhero__metrics">
                <span>
                  <b>56</b> chat / min
                </span>
                <span>
                  <b>19</b> emotes / min
                </span>
              </div>
              <div className="sl-mrhero__thumbs" aria-hidden="true">
                {TOP_MOMENT_THUMBS.map((id) => (
                  <img key={id} src={seventvImageUrl(id, '1x')} alt="" loading="lazy" decoding="async" />
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
                    {spike.emotes.map((id) => (
                      <img key={id} src={seventvImageUrl(id, '1x')} alt="" loading="lazy" decoding="async" />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Past streams — past VODs + full analytics shortcut */}
          <div className="sl-ext__card sl-pv">
            <div className="sl-ext__cardh">
              <span>Past streams</span>
              <span className="sl-pv__count">{PAST_VODS.length}</span>
            </div>
            <div className="sl-ext__hint">Watch a VOD or open its analytics</div>
            <div className="sl-pv__list">
              {PAST_VODS.map((vod) => (
                <div className="sl-pv__row" key={vod.title}>
                  <span className="sl-pv__thumb" data-tone={vod.tone} aria-hidden="true">
                    <span className="sl-pv__len">{vod.len}</span>
                    <span className="sl-pv__play">
                      <PlayGlyph />
                    </span>
                  </span>
                  <span className="sl-pv__meta">
                    <strong className="sl-pv__title">{vod.title}</strong>
                    <span className="sl-pv__date">{vod.date}</span>
                  </span>
                  <span className={`sl-pv__status is-${vod.tone}`}>{vod.status}</span>
                </div>
              ))}
            </div>
            <div className="sl-pv__foot" aria-hidden="true">
              View full analytics →
            </div>
          </div>
        </div>
      </div>
      <p className="sl-ext__scrollhint" aria-hidden="true">
        Scroll for moments
      </p>
    </div>
  )
}
