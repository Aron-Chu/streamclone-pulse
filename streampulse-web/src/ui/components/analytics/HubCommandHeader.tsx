import {

  formatActivityWindowLabel,

  peakActivityChatPerMin,

  peakActivityEmotesPerMin,

  peakActivityViewers,

} from '../../../lib/hubActivitySummary'

import { livePoolViewerSum } from '../../../lib/hubMetricHelpers'

import type { PublicHub } from '../../../lib/publicHub'

import { useCommandCenterLabels } from '../../providers/AnalyticsThemeProvider'

import { compact } from './hubFormat'

import { KpiCard } from './primitives/KpiCard'



export interface HubCommandHeaderProps {

  hub: PublicHub

  loading?: boolean

}



type KpiItem = {

  label: string

  value: string

  tone: 'accent' | 'neutral' | 'viewers' | 'chat'

  sub?: string

  title?: string

  showLiveDot?: boolean

}



export function HubCommandHeader({ hub, loading }: HubCommandHeaderProps) {

  const labels = useCommandCenterLabels()

  const windowLabel = formatActivityWindowLabel(hub.activity.windowMinutes)

  const peakViewers = peakActivityViewers(hub.activity.points, hub.activity.windowMinutes)

  const peakChat = peakActivityChatPerMin(hub.activity.points, hub.activity.windowMinutes)

  const peakEmotes = peakActivityEmotesPerMin(hub.activity.points, hub.activity.windowMinutes)

  const liveInPool = hub.poolSize > 0 ? hub.poolSize : hub.liveChannels.length

  const rosterLive = hub.corpusPipeline.roster?.live ?? 0

  const collectorActive = hub.corpusPipeline.collectorActive

  const collectorMax = hub.corpusPipeline.collectorMax

  const ircSub = collectorMax > 0 ? `${collectorActive}/${collectorMax} IRC` : undefined

  const rosterDiffersFromPool = rosterLive > 0 && rosterLive !== liveInPool

  const liveViewersNow = livePoolViewerSum(hub)



  const liveNowKpis: KpiItem[] = [

    {

      label: 'Live in pool',

      value: compact(liveInPool),

      tone: 'accent',

      sub: ircSub,

      showLiveDot: true,

      title:

        'Channels with active IRC collectors in the hosted live pool — not all of Twitch, and not lifetime stream count.',

    },

    ...(rosterDiffersFromPool

      ? [

          {

            label: 'Roster live',

            value: compact(rosterLive),

            tone: 'neutral' as const,

            title:

              'Top-N roster channels marked live by metadata — can differ from IRC-collecting pool capacity.',

          },

        ]

      : []),

    {

      label: 'Live viewers now',

      value: liveViewersNow > 0 ? compact(liveViewersNow) : '—',

      tone: 'viewers',

      title:

        'Sum of viewer counts on hub live-channel rows right now. Snapshot only — can be lower than the window peak below.',

    },

  ]



  const windowKpis: KpiItem[] = [

    {

      label: 'Peak viewers',

      value: peakViewers > 0 ? compact(peakViewers) : '—',

      tone: 'viewers',

      sub: `last ${windowLabel}`,

      title:

        'Highest network viewer total in the activity window from minute rollups (plus Top-N Helix when higher). Not Twitch-wide.',

    },

    {

      label: 'Peak chat/min',

      value: peakChat > 0 ? compact(peakChat) : '—',

      tone: 'chat',

      sub: `last ${windowLabel}`,

      title: 'Peak IRC chat messages per minute summed across tracked channels in this window.',

    },

    {

      label: 'Peak emotes/min',

      value: peakEmotes > 0 ? compact(peakEmotes) : '—',

      tone: 'chat',

      sub: `last ${windowLabel}`,

      title:

        'Peak emote uses per minute summed across tracked channels in this window — matches the activity chart, not a lifetime average.',

    },

  ]



  return (

    <header className="hub-command-header" aria-labelledby="hub-command-title">

      <div className="hub-command-header__copy">

        <div className="hub-command-header__copy-top">

          <p className="hub-command-header__eyebrow">{labels.hubEyebrow}</p>

        </div>

        <h1 id="hub-command-title" className="hub-command-header__title">

          {labels.hubTitle}

        </h1>

        <p className="hub-command-header__lede">{labels.hubLede}</p>

      </div>

      <div className="hub-command-header__kpi-groups">

        <section className="hub-command-header__kpi-group" aria-label="Live right now">

          <h2 className="hub-command-header__kpi-group-label">Right now</h2>

          <div className="hub-command-header__kpis">

            {liveNowKpis.map(({ label, value, tone, sub, title, showLiveDot }) => (

              <KpiCard

                key={label}

                label={label}

                value={value}

                tone={tone}

                sub={sub}

                title={title}

                loading={loading}

                showLiveDot={showLiveDot}

              />

            ))}

          </div>

        </section>

        <section className="hub-command-header__kpi-group" aria-label={`Activity peaks in the last ${windowLabel}`}>

          <h2 className="hub-command-header__kpi-group-label">Last {windowLabel}</h2>

          <div className="hub-command-header__kpis">

            {windowKpis.map(({ label, value, tone, sub, title }) => (

              <KpiCard

                key={label}

                label={label}

                value={value}

                tone={tone}

                sub={sub}

                title={title}

                loading={loading}

              />

            ))}

          </div>

        </section>

      </div>

    </header>

  )

}
