export const LATE_LOADING_LINE = 'Still loading. Live data can take a moment.'

/**
 * Row-shaped placeholders in the list's own frame (L1, 11-13): the thumbnail slot,
 * creator, title lines and emotes of a MomentRow, so the rows land without a jump.
 *
 * Each placeholder is built from a MomentRow's own parts and classes (L, round 2 11-13),
 * so the same CSS and list-width rules give it the real row's height at every width.
 * Typical words hold each part's width; only the grey bars show. data-placeholder
 * tells them apart from loaded rows, which share the class (round 3, 11-13).
 *
 * The first placeholder holds the page's loading status (role=status, empty at first). When
 * `late`, it shows the late line in place of its grey bars, in the same box, so the line covers
 * nothing, moves nothing, and the first row later takes that box (L, round 5 11-13). The grey
 * parts are hidden from assistive tech one by one, so the status stays readable.
 */
export function MomentLoadingSkeleton({ rows = 5, late = false }: { rows?: number; late?: boolean }) {
  return <div className="moments-loading">
    {Array.from({ length: rows }, (_, i) => <div className="moments-result moments-loading__row" data-placeholder="" data-late={i === 0 && late ? '' : undefined} key={i}>
      {i === 0 ? <p className="moments-loading-status" role="status">{late ? LATE_LOADING_LINE : ''}</p> : null}
      <div className="moments-card-slot" aria-hidden="true" />
      <div className="moments-creator-link" aria-hidden="true">
        <span className="moments-avatar" />
        <span><strong className="moments-loading__bar">Streamer name</strong><small>Just Chatting</small></span>
      </div>
      <div className="moments-result-body" aria-hidden="true">
        <p className="moments-result-title"><span className="moments-card-primary"><span className="moments-loading__bar">Emote spike</span></span></p>
        <p className="moments-result-timing"><span>12 min ago</span><span>Nov 13, 2026, 4:13 PM MST</span><span>about 1:30:00 into broadcast</span></p>
        <div className="moments-result-evidence"><span className="moments-loading__bar">420 chat/min</span><span className="moments-loading__bar">180 emotes/min</span><span>6.2× more emotes</span></div>
      </div>
      <div className="moments-row-emotes" aria-hidden="true"><i /><i /><i /></div>
      <div className="moments-actions" aria-hidden="true"><a>Analytics →</a><a>View stream timeline</a><span className="moment-save-control"><button type="button" disabled tabIndex={-1}>Save</button></span></div>
    </div>)}
  </div>
}

/** The games row and the filters keep their space while Latest first loads (L1, 11-13). */
export function MomentsTopPlaceholder() {
  return <div className="moments-loading-top" aria-hidden="true">
    <ul className="moments-covers">
      {Array.from({ length: 6 }, (_, i) => <li key={i}><span className="moments-cover-art" /><span className="moments-loading__name" /><span className="moments-loading__count" /></li>)}
    </ul>
    <span className="moments-loading__filters" />
  </div>
}
