import { cn } from '../../primitives/cn'
import type { PreviewModel } from './landingData'

/**
 * Stylised "channel console" shown in the hero. Visual-only preview of what the
 * hosted console surfaces (heat bars + most-reacted moments). Real headline values
 * are injected from the live hub when available, otherwise representative samples.
 */
export function LiveConsolePreview({ model }: { model: PreviewModel }) {
  return (
    <div className="sl-preview" role="img" aria-label={`Console preview for ${model.channel}: chat activity heatmap and top reacted moments`}>
      <div className="sl-preview__bar" aria-hidden="true">
        <i />
        <i />
        <i />
        <span>streampulse.stream/analytics/{model.channel}</span>
      </div>
      <div className="sl-preview__body">
        <div className="sl-pchan">
          <span className="sl-pchan__av" aria-hidden="true">
            {model.initial}
          </span>
          <div>
            <strong>{model.channel}</strong>
            <small>
              {model.category} · {model.viewers} viewers
            </small>
          </div>
          {model.live ? (
            <span className="sl-pchan__live">
              <span className="sl-dot" aria-hidden="true" />
              LIVE
            </span>
          ) : null}
        </div>

        <div className="sl-heatlabel" aria-hidden="true">
          <span>Chat velocity</span>
          <span>last session</span>
        </div>
        <div className="sl-heat" aria-hidden="true">
          {model.bars.map((bar, index) => (
            <i
              key={index}
              className={cn(bar.level === 'hot' && 'hot', bar.level === 'peak' && 'peak')}
              style={{ height: `${Math.round(bar.height * 100)}%` }}
            />
          ))}
        </div>

        <div className="sl-pmom">
          <span className="sl-pmh">Most reacted</span>
          {model.moments.map((moment, index) => (
            <div className="sl-mom" key={`${moment.time}-${index}`}>
              <span className="sl-mom__t">{moment.time}</span>
              <span className="sl-mom__s">{moment.summary}</span>
              {moment.emote ? <span className="sl-mom__em">{moment.emote}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
