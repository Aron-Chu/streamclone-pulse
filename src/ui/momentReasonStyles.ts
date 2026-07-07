import type { CSSProperties } from 'react'
import { isEmoteSpikeReason, isViewerSpikeReason } from '@streamclone/pulse-core'
import { theme } from './theme.ts'

export function momentReasonLabelStyle(
  reason: string,
  reasonLabel?: string,
  size: 'sm' | 'md' = 'sm',
): CSSProperties {
  const fontSize = size === 'md' ? 12 : 10
  const base: CSSProperties = { fontSize, fontWeight: 600 }
  if (isEmoteSpikeReason(reason) || isEmoteSpikeReason(reasonLabel ?? '')) {
    return { ...base, color: '#6ee7b7' }
  }
  if (isViewerSpikeReason(reason) || isViewerSpikeReason(reasonLabel ?? '')) {
    return { ...base, color: theme.accentSoft }
  }
  return { ...base, color: theme.textMuted }
}

export const overlayTextLinkButton: CSSProperties = {
  background: 'transparent',
  border: 0,
  color: theme.accentSoft,
  cursor: 'pointer',
  font: 'inherit',
  fontWeight: 700,
  padding: 0,
  textDecoration: 'underline',
  textDecorationColor: 'rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35)',
  textUnderlineOffset: 2,
}

export const overlayGhostChipButton: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: theme.radiusButton,
  color: theme.textSecondary,
  cursor: 'pointer',
  fontSize: 9,
  fontWeight: 700,
  padding: '4px 8px',
  whiteSpace: 'nowrap',
}
