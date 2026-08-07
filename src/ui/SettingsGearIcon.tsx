import type { CSSProperties } from 'react'

export interface SettingsGearIconProps {
  size?: number
  className?: string
  style?: CSSProperties
}

/** Clean cog for settings FAB / dock — animated via `.pulse-settings-gear-icon` CSS. */
export function SettingsGearIcon({ size = 16, className, style }: SettingsGearIconProps) {
  const classes = ['pulse-settings-gear-icon', className].filter(Boolean).join(' ')
  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={style}
    >
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.7 7.7 0 0 0-1.7-1L14.8 3h-5.6l-.5 2.9a7.7 7.7 0 0 0-1.7 1l-2.5-1-2 3.5L4.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.7 7.7 0 0 0 1.7 1l.5 2.9h5.6l.5-2.9a7.7 7.7 0 0 0 1.7-1l2.5 1 2-3.5L19.4 13Z"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
