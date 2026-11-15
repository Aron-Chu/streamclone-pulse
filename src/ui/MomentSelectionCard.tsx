import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { extensionEmoteImageUrls } from '../shared/emoteUrl.ts'
import type { ExtensionEmote } from '../shared/messages.ts'
import type { MomentPictureView } from '../shared/momentFramesContract.ts'
import { useMomentBookmarks, type BookmarkTarget } from './momentBookmarks.tsx'
import { useMomentPicture, type MomentGame } from './momentPicture.ts'
import { formatCount } from './mostReacted.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import type { JumpNote, JumpPromise, JumpResult } from './jumpMomentAction.ts'
import { MomentTime } from './MomentTime.tsx'

export type MomentSelectionEmote = Pick<
  ExtensionEmote,
  'id' | 'providerEmoteId' | 'name' | 'imageUrl' | 'count' | 'provider'
> & { key?: string }

export interface MomentSelectionCardProps {
  kind: 'minute' | 'moment'
  label: string
  /** h:mm:ss. */
  timeLabel: string
  /** Only the minute is known: a quiet 'about' before the time (K1). */
  about?: boolean
  detail: ReactNode
  detailStyle?: CSSProperties
  activityLine: string
  activityTitle?: string
  viewerSampleState?: 'sampled' | 'not-sampled'
  topEmotes?: readonly MomentSelectionEmote[]
  backendUrl: string
  jumpLabel: string
  /** Its note shows under the buttons, as a status (U). */
  onJump?: () => JumpResult
  onAnalytics?: () => void
  onClose?: () => void
  className?: string
  /**
   * Identity of the selection shown. When it changes the details fade in place
   * instead of the card remounting and sliding in again. They keep their
   * nodes, so a focused action keeps focus when a poll swaps the moment.
   */
  contentKey?: string
  ariaLabel: string
  style?: CSSProperties
  /** What the player showed then, when this tab kept frames of it. */
  picture?: MomentPictureView
  /** The game on stream at the selected time. */
  game?: MomentGame
  /** What the card's bookmark saves; shown inside the panel's bookmarks only. */
  bookmark?: BookmarkTarget
}

/** Shared presentation for committed ranked-moment and raw-minute selections. */
export function MomentSelectionCard({
  kind,
  label,
  timeLabel,
  about,
  detail,
  detailStyle,
  activityLine,
  activityTitle,
  viewerSampleState,
  topEmotes = [],
  backendUrl,
  jumpLabel,
  onJump,
  onAnalytics,
  onClose,
  className,
  contentKey,
  ariaLabel,
  style,
  picture,
  game,
  bookmark,
}: MomentSelectionCardProps) {
  const bookmarks = useMomentBookmarks()
  const canBookmark = Boolean(bookmark && bookmarks?.canSave)
  const saved = canBookmark ? bookmarks!.savedFor(bookmark!) != null : false
  const contentRef = useRef<HTMLDivElement>(null)
  // The last Jump's result, kept for the moment it was pressed on.
  const [note, setNote] = useState<JumpNote & { key?: string } | null>(null)
  const shownNote = note?.key === contentKey ? note : null
  // With no picture of the moment the card opens on the game's box art, or on
  // chat's top emote for Just Chatting (its box art says nothing).
  const art = game?.name.toLowerCase() === 'just chatting' ? undefined : game?.art
  const emote = topEmotes[0] ? extensionEmoteImageUrls(topEmotes[0], backendUrl)[0] : undefined
  const pictureRef = useMomentPicture<HTMLDivElement>(picture && { ...picture, art, emote })
  const shownKeyRef = useRef(contentKey)
  // The first selection fades in with the card itself; a swap restarts the
  // details' fade on the same nodes (a key remount would drop focus).
  useLayoutEffect(() => {
    if (contentKey === shownKeyRef.current) return
    shownKeyRef.current = contentKey
    const content = contentRef.current!
    content.className = ''
    content.getBoundingClientRect()
    content.className = 'pulse-moment-card-swap'
  }, [contentKey])
  return (
    <div
      className={['pulse-moment-selection-card pulse-sel', className].filter(Boolean).join(' ')}
      data-selected-moment-card={kind === 'moment' ? 'true' : undefined}
      data-chart-minute-card={kind === 'minute' ? 'true' : undefined}
      data-moment-inspector-card="true"
      data-moment-inspector-state="selected"
      data-chart-action="true"
      style={style}
      aria-label={ariaLabel}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div ref={contentRef}>
        <div ref={pictureRef} className="pmf-stage" data-moment-picture="true" />
        <div className="pulse-sel-header">
          <span className="pulse-sel-kicker">{label}</span>
          <span className="pulse-sel-offset" data-moment-inspector-clock="true"><MomentTime text={timeLabel} about={about} /></span>
          {onClose ? (
            <button
              type="button"
              className="pulse-sel-close"
              aria-label={`Clear ${kind === 'minute' ? 'selected minute' : 'selected moment'}`}
              title="Clear selection"
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </div>

        <p className="pulse-sel-detail" style={detailStyle}>{detail}</p>
        {game ? (
          <p className="pulse-sel-game" data-moment-game="true" title={`Playing ${game.name}`}>
            {game.art ? (
              <img
                src={game.art}
                alt=""
                width={12}
                height={16}
                className="pulse-sel-game-art"
                onError={event => { event.currentTarget.style.display = 'none' }}
              />
            ) : null}
            <span className="pulse-sel-game-name">{game.name}</span>
          </p>
        ) : null}
        <p
          className="pulse-sel-activity"
          data-moment-inspector-activity="true"
          data-viewer-sample-state={viewerSampleState}
          title={activityTitle}
        >
          {activityLine}
        </p>

        {topEmotes.length > 0 ? (
          <ul
            className="pulse-sel-list"
            aria-label={`Top emotes for selected ${kind}`}
            data-moment-inspector-emotes="true"
          >
            {topEmotes.slice(0, 3).map(emote => (
              <li
                key={emote.key ?? emote.id ?? emote.name}
                className="pulse-sel-item"
                data-emote-name={emote.name}
                data-moment-inspector-emote-row="true"
                title={`${emote.name}: ${formatCount(emote.count)} uses`}
              >
                <PulseEmoteImg
                  emote={emote}
                  backendUrl={backendUrl}
                  width={18}
                  height={18}
                  style={emoteImgStyle}
                  eager
                  showHoverPreview
                  previewFocusable
                />
                <span className="pulse-sel-name">{emote.name}</span>
                <span className="pulse-sel-uses">{formatCount(emote.count)} uses</span>
              </li>
            ))}
          </ul>
        ) : null}

        {onJump || onAnalytics || canBookmark ? (
          <div className="pulse-sel-actions">
            {onJump ? (
              <button
                type="button"
                className="pulse-action-chip pulse-action-chip-primary pulse-sel-primary"
                data-moment-inspector-action="jump"
                onClick={() => void (onJump() as JumpPromise)?.then(next => next && setNote({ ...next, key: contentKey }))}
              >
                <span aria-hidden="true" className="pulse-sel-play" data-selected-moment-play-icon="true">▶</span>
                {jumpLabel}
              </button>
            ) : null}
            {canBookmark ? (
              <button
                type="button"
                className="pulse-action-chip pulse-card-bookmark"
                data-moment-inspector-action="bookmark"
                data-moment-action="bookmark"
                data-moment-save-state={saved ? 'saved' : bookmarks!.busy ? 'saving' : 'ready'}
                aria-pressed={saved}
                // Not disabled while busy: a disabled button drops its focus to the
                // page. The bookmark context runs one change at a time.
                aria-busy={bookmarks!.busy}
                aria-label={`${saved ? 'Saved' : 'Save'} ${kind} at ${about ? 'about ' : ''}${timeLabel}`}
                onClick={() => bookmarks!.toggle(bookmark!)}
              >
                {saved ? '✓ Saved' : 'Save'}
              </button>
            ) : null}
            {onAnalytics ? (
              // Never moves or changes: a Jump note shows beside or under it (U).
              <button
                type="button"
                className="pulse-sel-link"
                data-moment-inspector-action="analytics"
                onClick={onAnalytics}
              >
                <span className="pulse-sel-link-text">Analytics</span>
                <span aria-hidden="true" className="pulse-sel-link-icon">↗</span>
              </button>
            ) : null}
            {onJump ? (
              // In the space under the buttons the card already keeps, wrapped rather than cut.
              <p className={`pulse-sel-note${shownNote?.ok === false ? ' pulse-note-warn' : ''}`} role="status">
                {shownNote?.text}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** PulseEmoteImg merges this into its own inline style. */
const emoteImgStyle: CSSProperties = { display: 'block', flexShrink: 0, objectFit: 'contain' }
