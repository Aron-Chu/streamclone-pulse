interface RoadmapItem {
  title: string
  tag?: string
  status: string
  state: 'live' | 'progress' | 'planned'
  copy: string
  /** 0..100 determinate progress for in-progress items. */
  progress?: number
}

const ITEMS: RoadmapItem[] = [
  {
    title: 'Hosted analytics console',
    tag: 'StreamPulse',
    status: 'Live',
    state: 'live',
    copy: 'Find tracked channels, compare reaction signals, and open timestamped moments with visible measurement coverage.',
  },
  {
    title: 'Chrome extension overlay',
    tag: 'StreamPulse',
    status: 'Live',
    state: 'live',
    copy: 'Live coverage, chat/min, and most-reacted moments rendered straight into the Twitch sidebar while you watch.',
  },
  {
    title: 'ReplayForge — Clip Studio',
    tag: 'ReplayForge',
    status: 'Planned',
    state: 'planned',
    copy: 'Next: an authorized moment-to-clip handoff, preview, focused editing, and download. Access and source permissions are required; no public launch date is promised.',
  },
]

export function RoadmapTimeline() {
  return (
    <ol className="sl-road">
      {ITEMS.map((item) => (
        <li className={`sl-ritem sl-ritem--${item.state}`} key={item.title}>
          <span className="sl-rnode" aria-hidden="true" />
          <div className="sl-card sl-rcard">
            <div className="sl-rcard__top">
              {item.tag ? <span className="sl-rtag">{item.tag}</span> : null}
              <span className={`sl-rstat sl-rstat--${item.state}`}>
                {item.state !== 'planned' ? <span className="sl-dot" aria-hidden="true" /> : null}
                {item.status}
              </span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.copy}</p>
            {item.state === 'progress' && item.progress != null ? (
              <div
                className="sl-progbar"
                role="progressbar"
                aria-valuenow={item.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${item.title} progress`}
              >
                <span className="sl-progbar__fill" style={{ width: `${item.progress}%` }} />
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}
