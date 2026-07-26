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
    copy: 'Search any tracked Twitch channel and open the full Streamclone console: chat velocity, emote bursts, session ledgers, and moment review.',
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
    copy: 'Planned operator workflow: turn detected peaks into shareable clips via ReplayForge. Stays in the private dashboard — not a public launch surface yet.',
  },
  {
    title: 'ClipTrace — reverse VOD origin resolver',
    tag: 'ClipTrace',
    status: 'Planned',
    state: 'planned',
    copy: 'Paste a clip, VOD link, or a line of chat and jump back to the exact stream moment it came from, with confidence-scored evidence.',
  },
  {
    title: 'Public API & spike alerts',
    tag: 'StreamPulse',
    status: 'Planned',
    state: 'planned',
    copy: 'Programmatic access to sanitized peaks plus opt-in notifications when a channel you follow erupts.',
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
            {item.state === 'progress' ? (
              <div
                className="sl-progbar"
                role="progressbar"
                aria-valuenow={item.progress ?? 50}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${item.title} progress`}
              >
                <span className="sl-progbar__fill" style={{ width: `${item.progress ?? 50}%` }} />
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}
