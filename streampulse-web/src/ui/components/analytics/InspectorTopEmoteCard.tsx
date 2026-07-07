import { BACKEND_SHARE_TITLE, formatSharePctLabel } from '../../../lib/emoteShare'
import { compact, initial, providerCssVarKey, providerLabel } from './hubFormat'
import { EmoteImg } from './EmoteImg'

export interface InspectorTopEmoteCardEmote {
  name: string
  provider?: string
  imageUrl?: string
  count?: number
}

export interface InspectorTopEmoteCardProps {
  emote: InspectorTopEmoteCardEmote
  headline: string
  countUnit?: string
  topShare?: number
  className?: string
}

function InspectorEmoteImage({ src, name }: { src: string; name: string }) {
  return (
    <EmoteImg
      src={src}
      name={name}
      fallbackClassName="pulse-moments__inspector-top-emote-fallback pulse-moments__inspector-top-emote-fallback--hero"
    />
  )
}

export function InspectorTopEmoteCard({
  emote,
  headline,
  countUnit = 'uses',
  topShare,
  className,
}: InspectorTopEmoteCardProps) {
  const emoteTitle = `${emote.name}${emote.count != null ? ` · ${compact(emote.count)} ${countUnit}` : ''}`

  return (
    <div
      className={`pulse-moments__inspector-emote-card${className ? ` ${className}` : ''}`}
      title={emoteTitle}
    >
      <div className="pulse-moments__inspector-emote-card-head">
        <span className="pulse-moments__inspector-top-emote-label">{headline}</span>
      </div>
      <div className="pulse-moments__inspector-emote-card-body">
        <div className="pulse-moments__inspector-emote-frame">
          {emote.imageUrl ? (
            <InspectorEmoteImage src={emote.imageUrl} name={emote.name} />
          ) : (
            <span
              className="pulse-moments__inspector-top-emote-fallback pulse-moments__inspector-top-emote-fallback--hero"
              aria-hidden="true"
            >
              {initial(emote.name)}
            </span>
          )}
        </div>
        <div className="pulse-moments__inspector-emote-details">
          <div className="pulse-moments__inspector-emote-title-row">
            <span className="pulse-moments__inspector-top-emote-name" title={emote.name}>
              {emote.name}
            </span>
            {emote.provider ? (
              <span
                className="pulse-moments__inspector-provider"
                data-provider={providerCssVarKey(emote.provider)}
              >
                {providerLabel(emote.provider)}
              </span>
            ) : null}
          </div>
          {emote.count != null ? (
            <p className="pulse-moments__inspector-emote-stat-row">
              <span className="pulse-moments__inspector-emote-stat-group">
                <strong>{compact(emote.count)}</strong>
                <span className="pulse-moments__inspector-emote-stat-unit">{countUnit}</span>
              </span>
            </p>
          ) : null}
          {topShare != null && Number.isFinite(topShare) && topShare > 0 ? (
            <p className="pulse-moments__inspector-emote-share-row">
              <span
                className="pulse-moments__inspector-emote-share-line"
                title={`${formatSharePctLabel(topShare)} — ${BACKEND_SHARE_TITLE}`}
              >
                {formatSharePctLabel(topShare)} of emotes
              </span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
