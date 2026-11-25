import type { ReactNode } from 'react'

/**
 * Placeholder emotes for the /brainchat demo: eight original drawings from the
 * BrainChat feel kit (8 Nov). They are not, and must not be read as, any
 * Twitch, 7TV, BTTV or FFZ emote. The house shape is a speech-bubble blob with
 * its tail at lower left. Still pictures: nothing loops or moves.
 */
export const EMOTE_NAMES = ['hypeBlob', 'lolBlob', 'tiltBlob', 'clapBlob', 'saltBlob', 'calmBlob', 'shockBlob', 'heartBlob'] as const
export type EmoteName = (typeof EMOTE_NAMES)[number]

const INK = '#261C36'
const CREAM = '#FFF4DC'
const SUN = '#FFC94D'
const PEACH = '#FF9C73'
const ROSE = '#FF86B8'
const LILAC = '#B49CFF'
const SKY = '#7CC2FF'
const MINT = '#72D9BF'
const SLATE = '#AAA4B9'

const BODY_D = 'M14 3.6C20.4 3.6 24.8 8 24.8 13.7C24.8 19.4 20.4 23.5 14 23.5C12.5 23.5 11.1 23.3 9.8 22.9L5.4 25.3L6.5 21.1C4.4 19.3 3.2 16.7 3.2 13.7C3.2 8 7.6 3.6 14 3.6Z'
const STROKE = { fill: 'none', stroke: INK, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function Body({ fill, shine = true }: { fill: string; shine?: boolean }) {
  return (
    <>
      <path d={BODY_D} fill={fill} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      {shine ? <path d="M7.6 8.2Q8.7 6.6 10.4 6" fill="none" stroke={CREAM} strokeWidth={1.4} strokeLinecap="round" /> : null}
    </>
  )
}

const ART: Record<EmoteName, ReactNode> = {
  // Wide eyes, open grin, one sparkle.
  hypeBlob: (
    <>
      <Body fill={SUN} />
      <circle cx="9.8" cy="12.4" r="2.8" fill={CREAM} stroke={INK} strokeWidth={1.3} />
      <circle cx="18.2" cy="12.4" r="2.8" fill={CREAM} stroke={INK} strokeWidth={1.3} />
      <circle cx="10.1" cy="12.8" r="1.5" fill={INK} />
      <circle cx="18.5" cy="12.8" r="1.5" fill={INK} />
      <path d="M10.4 17.1Q14 21.6 17.6 17.1Z" fill={INK} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M23.4 0.9Q24 4 27.1 4.6Q24 5.2 23.4 8.3Q22.8 5.2 19.7 4.6Q22.8 4 23.4 0.9Z" fill={CREAM} stroke={INK} strokeWidth={1.1} strokeLinejoin="round" />
    </>
  ),
  // Squeezed-shut > < eyes, big open mouth with a tongue.
  lolBlob: (
    <>
      <Body fill={ROSE} />
      <path d="M8.2 10.3L11.3 12.3L8.2 14.3" {...STROKE} strokeWidth={1.7} />
      <path d="M19.8 10.3L16.7 12.3L19.8 14.3" {...STROKE} strokeWidth={1.7} />
      <path d="M8.6 15.6H19.4Q19.2 21.6 14 21.6Q8.8 21.6 8.6 15.6Z" fill={INK} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M11.2 20.4Q14 17.8 16.8 20.4Q14 21.5 11.2 20.4Z" fill={PEACH} />
    </>
  ),
  // Body tipped over, worried brows, wobbly mouth, sweat drop.
  tiltBlob: (
    <>
      <g transform="rotate(-10 14 14)">
        <Body fill={SKY} />
        <path d="M8.2 9.9L11.5 8.7" {...STROKE} strokeWidth={1.4} />
        <path d="M16.5 8.7L19.8 9.9" {...STROKE} strokeWidth={1.4} />
        <circle cx="10.2" cy="12.7" r="1.6" fill={INK} />
        <circle cx="17.8" cy="12.7" r="1.6" fill={INK} />
        <path d="M9.6 18.2q1.1 -1.4 2.2 0t2.2 0t2.2 0t2.2 0" {...STROKE} strokeWidth={1.5} />
      </g>
      <path d="M23.6 3.2C25.4 6 26.2 7.3 26.2 8.6A2.6 2.6 0 0 1 21 8.6C21 7.3 21.8 6 23.6 3.2Z" fill={CREAM} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
    </>
  ),
  // Happy ^ ^ eyes, two hands meeting palm to palm, small clap marks.
  clapBlob: (
    <>
      <Body fill={PEACH} />
      <path d="M8.6 12.6Q10.4 10.2 12.2 12.6" {...STROKE} strokeWidth={1.6} />
      <path d="M15.8 12.6Q17.6 10.2 19.4 12.6" {...STROKE} strokeWidth={1.6} />
      <path d="M12.6 14.9Q14 16.5 15.4 14.9Z" fill={INK} stroke={INK} strokeWidth={1.1} strokeLinejoin="round" />
      <ellipse cx="12.2" cy="20" rx="2.6" ry="3.6" transform="rotate(-18 12.2 20)" fill={CREAM} stroke={INK} strokeWidth={1.3} />
      <ellipse cx="15.8" cy="20" rx="2.6" ry="3.6" transform="rotate(18 15.8 20)" fill={CREAM} stroke={INK} strokeWidth={1.3} />
      <path d="M8.4 17.4l-1.7 -0.9M8.1 20.2H6.3M19.6 17.4l1.7 -0.9M19.9 20.2h1.8" {...STROKE} strokeWidth={1.2} />
    </>
  ),
  // Heavy brows slanting in, flat frown, two salt grains.
  saltBlob: (
    <>
      <Body fill={SLATE} shine={false} />
      <path d="M7.9 9.6L12.1 11.2" {...STROKE} strokeWidth={2} />
      <path d="M20.1 9.6L15.9 11.2" {...STROKE} strokeWidth={2} />
      <circle cx="10.4" cy="13.6" r="1.5" fill={INK} />
      <circle cx="17.6" cy="13.6" r="1.5" fill={INK} />
      <path d="M10.8 19.2Q14 16.6 17.2 19.2" {...STROKE} strokeWidth={1.6} />
      <rect x="21.3" y="1.4" width="3.6" height="3.6" rx="0.7" transform="rotate(15 23.1 3.2)" fill={CREAM} stroke={INK} strokeWidth={1.1} />
      <rect x="24.3" y="6.4" width="2.6" height="2.6" rx="0.5" transform="rotate(-12 25.6 7.7)" fill={CREAM} stroke={INK} strokeWidth={1} />
    </>
  ),
  // Closed lids, small smile.
  calmBlob: (
    <>
      <Body fill={MINT} />
      <path d="M8.6 12.4Q10.4 14.4 12.2 12.4" {...STROKE} strokeWidth={1.6} />
      <path d="M15.8 12.4Q17.6 14.4 19.4 12.4" {...STROKE} strokeWidth={1.6} />
      <path d="M12 17.1Q14 18.7 16 17.1" {...STROKE} strokeWidth={1.5} />
    </>
  ),
  // Pale with shock: raised brows, tall pupils, round open mouth.
  shockBlob: (
    <>
      <Body fill={CREAM} shine={false} />
      <path d="M8.2 8.6Q10.2 6.9 12.2 8.1" {...STROKE} strokeWidth={1.4} />
      <path d="M15.8 8.1Q17.8 6.9 19.8 8.6" {...STROKE} strokeWidth={1.4} />
      <ellipse cx="10.2" cy="12.2" rx="1.5" ry="2.1" fill={INK} />
      <ellipse cx="17.8" cy="12.2" rx="1.5" ry="2.1" fill={INK} />
      <ellipse cx="14" cy="18.1" rx="2.4" ry="3" fill={INK} />
    </>
  ),
  // Happy ^ ^ eyes, hugging a heart.
  heartBlob: (
    <>
      <Body fill={LILAC} />
      <path d="M8.6 11.6Q10.4 9.2 12.2 11.6" {...STROKE} strokeWidth={1.6} />
      <path d="M15.8 11.6Q17.6 9.2 19.4 11.6" {...STROKE} strokeWidth={1.6} />
      <path d="M14 23.2C9.2 20.5 8.6 17.9 9.6 16.3C10.8 14.5 13.2 14.7 14 16.7C14.8 14.7 17.2 14.5 18.4 16.3C19.4 17.9 18.8 20.5 14 23.2Z" fill={ROSE} stroke={INK} strokeWidth={1.3} strokeLinejoin="round" />
    </>
  ),
}

export function isEmoteName(value: string): value is EmoteName {
  return (EMOTE_NAMES as readonly string[]).includes(value)
}

/** One placeholder emote at a pixel size; its name is its accessible name. */
export function Emote({ name, size = 18, className }: { name: EmoteName; size?: number; className?: string }) {
  return (
    <span className={className ? `bc-emote ${className}` : 'bc-emote'} role="img" aria-label={name} data-emote={name}>
      <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden="true" focusable="false">{ART[name]}</svg>
    </span>
  )
}
