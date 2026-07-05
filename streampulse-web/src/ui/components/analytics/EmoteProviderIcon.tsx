import { providerCssVarKey, providerLabel, emoteProviderColor } from './hubFormat'

export interface EmoteProviderIconProps {
  provider?: string
  size?: number
  className?: string
}

const PROVIDER_INITIAL: Record<string, string> = {
  '7tv': '7',
  twitch: 'T',
  bttv: 'B',
  ffz: 'F',
}

function providerKey(provider?: string): string {
  return providerCssVarKey(provider)
}

export function EmoteProviderIcon({ provider, size = 16, className = '' }: EmoteProviderIconProps) {
  const key = providerKey(provider)
  const label = providerLabel(provider)
  const showInitial = size >= 18
  const initial = PROVIDER_INITIAL[key]

  return (
    <span
      className={`emote-provider-icon${className ? ` ${className}` : ''}`}
      data-provider={key}
      title={label}
      role="img"
      aria-label={label}
      style={{
        width: size,
        height: size,
        background: `var(--sp-provider-${key}, ${emoteProviderColor(provider)})`,
      }}
    >
      {showInitial && initial ? (
        <span className="emote-provider-icon__initial" aria-hidden="true">
          {initial}
        </span>
      ) : null}
    </span>
  )
}
