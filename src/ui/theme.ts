/** Streamclone obsidian theme tokens (matches web app + Figma handoff). */
import { surfaceCssVar } from './surfaceTheme.ts'

export const accentTokens = {
  accent: 'var(--pulse-accent, #8b5cf6)',
  accentStrong: 'var(--pulse-accent-strong, #7c3aed)',
  /** Scheme-aware: dark text on light, pale on dark (via host override). */
  accentSoft: 'var(--pulse-accent-text-subtle, var(--pulse-accent-soft, #c4b5fd))',
  accentInk: 'var(--pulse-accent-text, var(--pulse-accent-ink, #ddd6fe))',
  accentText: 'var(--pulse-accent-text, var(--pulse-accent-ink, #ddd6fe))',
  accentTextSubtle: 'var(--pulse-accent-text-subtle, var(--pulse-accent-soft, #c4b5fd))',
  accentSurface: 'var(--pulse-accent-surface, rgba(139, 92, 246, 0.14))',
  onAccent: 'var(--pulse-on-accent, #ffffff)',
  borderAccent: 'var(--pulse-accent-border, rgba(139, 92, 246, 0.35))',
} as const

export const theme = {
  bg: surfaceCssVar('bg'),
  bgCanvas: surfaceCssVar('bgCanvas'),
  panel: surfaceCssVar('panel'),
  panelElevated: surfaceCssVar('panelElevated'),
  panelGlass: surfaceCssVar('panelGlass'),
  textPrimary: surfaceCssVar('textPrimary'),
  textSecondary: surfaceCssVar('textSecondary'),
  textMuted: surfaceCssVar('textMuted'),
  accent: accentTokens.accent,
  accentStrong: accentTokens.accentStrong,
  accentSoft: accentTokens.accentSoft,
  accentInk: accentTokens.accentInk,
  accentText: accentTokens.accentText,
  accentTextSubtle: accentTokens.accentTextSubtle,
  accentSurface: accentTokens.accentSurface,
  accent2: '#22d3ee',
  rank1: '#f97316',
  live: '#22c55e',
  liveSoft: surfaceCssVar('statusOkText'),
  border: surfaceCssVar('border'),
  borderSubtle: surfaceCssVar('borderSubtle'),
  borderAccent: accentTokens.borderAccent,
  hoverFill: surfaceCssVar('hoverFill'),
  inputBg: surfaceCssVar('inputBg'),
  chartBg: surfaceCssVar('chartBg'),
  shadow: surfaceCssVar('shadow'),
  error: surfaceCssVar('statusErrorText'),
  statusOkBg: surfaceCssVar('statusOkBg'),
  statusOkBorder: surfaceCssVar('statusOkBorder'),
  statusOkText: surfaceCssVar('statusOkText'),
  statusWarnBg: surfaceCssVar('statusWarnBg'),
  statusWarnBorder: surfaceCssVar('statusWarnBorder'),
  statusWarnText: surfaceCssVar('statusWarnText'),
  statusErrorBg: surfaceCssVar('statusErrorBg'),
  statusErrorBorder: surfaceCssVar('statusErrorBorder'),
  statusErrorText: surfaceCssVar('statusErrorText'),
  gameChipBg: surfaceCssVar('gameChipBg'),
  gameChipBorder: surfaceCssVar('gameChipBorder'),
  gameChipText: surfaceCssVar('gameChipText'),
  /** Scheme-aware warning ink (games labels, interrupted states). */
  warning: surfaceCssVar('gameChipText'),
  radiusPanel: 14,
  radiusButton: 9,
  radiusPill: 13,
  font: 'Inter, ui-sans-serif, system-ui, sans-serif',
  onAccent: accentTokens.onAccent,
} as const

export const shadowStyles = `
  :where(button, a, input, select, textarea, [tabindex]):focus-visible {
    outline: 2px solid ${theme.accent};
    outline-offset: 2px;
  }
  @keyframes pulse-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes bar-grow {
    from { transform: scaleY(0.2); opacity: 0.4; }
    to { transform: scaleY(1); opacity: 1; }
  }
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  @keyframes live-ping {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.35); opacity: 0.55; }
  }
  @keyframes row-rise {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes tab-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes pulse-view-enter-settings {
    from { opacity: 0; transform: translateX(12px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes pulse-view-enter-pulse {
    from { opacity: 0; transform: translateX(-12px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes pulse-mode-content-enter {
    from { opacity: 0; transform: translateY(4px) scale(0.995); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes pulse-route-content-enter {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse-select-menu-enter {
    from { opacity: 0; transform: translateY(-4px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes pulse-coverage-wait {
    0%, 100% { border-color: rgba(167, 139, 250, 0.35); }
    50% { border-color: rgba(167, 139, 250, 0.75); }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  .pulse-animate-in { animation: pulse-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .pulse-bar-grow { transform-origin: bottom center; animation: bar-grow 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .pulse-shimmer {
    background: linear-gradient(90deg, ${theme.panel} 0%, rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.18) 50%, ${theme.panel} 100%);
    background-size: 200% 100%;
    animation: shimmer 2.2s ease-in-out infinite;
  }
  .pulse-live-dot { animation: live-ping 1.8s ease-in-out infinite; }
  .pulse-row-rise { animation: row-rise 0.4s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .pulse-row-rise:hover { transform: translateY(-2px); box-shadow: 0 8px 20px ${theme.shadow}; }
  .pulse-moment-row-button {
    -webkit-tap-highlight-color: transparent;
    appearance: none;
    border: none !important;
    box-shadow: none !important;
    transform: none !important;
  }
  .pulse-moment-row-button:hover {
    box-shadow: none !important;
    transform: none !important;
  }
  .pulse-moment-row-button:focus,
  .pulse-moment-row-button:active {
    outline: none !important;
    box-shadow: none !important;
  }
  .pulse-moment-row-button:focus-visible .pulse-moment-row {
    box-shadow: inset 0 0 0 2px ${theme.accent} !important;
  }
  .pulse-moment-row-button .pulse-moment-row {
    border: none;
    box-shadow: inset 0 0 0 1px transparent;
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.03));
  }
  .pulse-moment-row-button:hover .pulse-moment-row {
    box-shadow: inset 0 0 0 1px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35) !important;
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.08) !important;
  }
  .pulse-moment-row-selected {
    box-shadow: inset 0 0 0 1px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45) !important;
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.14) !important;
  }
  .pulse-top-emote-chip {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.04));
    border: 1px solid transparent;
    border-radius: 4px;
    transition: transform 0.15s ease, border-color 0.15s ease;
  }
  .pulse-top-emote-chip:hover {
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45) !important;
    box-shadow: 0 6px 16px ${theme.shadow};
    transform: translateY(-1px) scale(1.04);
  }
  .pulse-top-emote-chip-selected {
    background: rgba(245, 158, 11, 0.12) !important;
    border-color: rgba(251, 191, 36, 0.45) !important;
    box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.18);
  }
  .pulse-seven-tv-toggle:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.03));
  }
  .pulse-seven-tv-row {
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }
  .pulse-seven-tv-row:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.06)) !important;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35) !important;
    transform: translateY(-1px);
  }
  .pulse-seven-tv-row-plotted:hover {
    background: var(--pulse-plot-bg) !important;
    border-color: var(--pulse-plot-color) !important;
    box-shadow: 0 4px 12px ${theme.shadow};
  }
  .pulse-seven-tv-row-active {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.08) !important;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.28) !important;
  }
  .pulse-chart-legend-chip {
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease,
      color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
  }
  .pulse-chart-legend-chip:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.08)) !important;
    border-color: var(--pulse-surface-border, rgba(255, 255, 255, 0.22)) !important;
    box-shadow: 0 4px 14px var(--pulse-surface-shadow, rgba(0, 0, 0, 0.28));
    color: ${theme.textPrimary} !important;
    transform: translateY(-1px);
  }
  .pulse-chart-legend-chip-focused {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.1)) !important;
    border-color: var(--pulse-surface-border, rgba(255, 255, 255, 0.28)) !important;
    color: ${theme.textPrimary} !important;
  }
  .pulse-chart-legend-chip-focused:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.14)) !important;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45) !important;
  }
  .pulse-chart-legend-chip-dimmed {
    opacity: 0.4;
  }
  .pulse-chart-legend-chip-dimmed:hover {
    opacity: 0.72 !important;
  }
  .pulse-chart-overlay-legend-chip {
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
  }
  .pulse-chart-overlay-legend-chip:hover {
    box-shadow: 0 4px 14px ${theme.shadow};
    transform: translateY(-1px) scale(1.03);
  }
  .pulse-chart-expand-btn {
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
  }
  .pulse-chart-expand-btn:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.1)) !important;
    border-color: var(--pulse-surface-border, rgba(255, 255, 255, 0.22)) !important;
    transform: translateY(-1px);
  }
  .pulse-chart-expand-btn-active:hover {
    background: rgba(139, 92, 246, 0.2) !important;
    border-color: rgba(167, 139, 250, 0.5) !important;
  }
  .pulse-recap-analytics-cta {
    transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  }
  .pulse-recap-analytics-cta:hover {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.92) !important;
    box-shadow: 0 6px 18px rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.35);
    transform: translateY(-1px);
  }
  .pulse-recap-highlight-btn {
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .pulse-recap-highlight-btn:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.07)) !important;
    border-color: var(--pulse-surface-border, rgba(255, 255, 255, 0.22)) !important;
    box-shadow: 0 4px 14px var(--pulse-surface-shadow, rgba(0, 0, 0, 0.24));
    transform: translateY(-1px);
  }
  .pulse-recap-highlight-btn-selected:hover {
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.55) !important;
  }
  .pulse-action-chip {
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .pulse-action-chip:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.08)) !important;
    border-color: var(--pulse-surface-border, rgba(255, 255, 255, 0.22)) !important;
    transform: translateY(-1px);
  }
  .pulse-action-chip-primary:hover {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.2) !important;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45) !important;
    box-shadow: 0 4px 12px rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22);
  }
  .pulse-secondary-btn {
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease,
      color 0.15s ease;
  }
  .pulse-secondary-btn:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.06)) !important;
    border-color: var(--pulse-surface-border, rgba(255, 255, 255, 0.2)) !important;
    color: ${theme.textPrimary} !important;
    transform: translateY(-1px);
  }
  .pulse-emote-hover-wrap {
    display: inline-flex;
    position: relative;
  }
  .pulse-emote-hover-preview {
    background: var(--pulse-surface-panel-glass, rgba(17, 17, 23, 0.96));
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35);
    border-radius: 10px;
    box-shadow: 0 12px 28px ${theme.shadow};
    display: none;
    left: 50%;
    padding: 8px;
    pointer-events: none;
    position: absolute;
    top: calc(100% + 8px);
    transform: translateX(-50%);
    z-index: 20;
  }
  .pulse-emote-hover-wrap:hover .pulse-emote-hover-preview {
    display: grid;
    justify-items: center;
  }
  .pulse-inspector-emote-row {
    border-radius: 8px;
    padding: 2px 4px;
    transition: background 0.15s ease;
  }
  .pulse-inspector-emote-row:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.05));
  }
  .pulse-sparkline-wrap {
    position: relative;
  }
  .pulse-sparkline-tooltip {
    background: var(--pulse-surface-panel-glass, rgba(17, 17, 23, 0.96));
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.3);
    border-radius: 8px;
    color: ${theme.textPrimary};
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    padding: 4px 8px;
    pointer-events: none;
    position: absolute;
    text-transform: uppercase;
    transform: translate(-50%, -100%);
    white-space: nowrap;
    z-index: 5;
  }
  .pulse-sparkline-tooltip--below {
    margin-top: 6px;
    transform: translate(-50%, 0);
  }
  .pulse-signal-wrap {
    position: relative;
    width: 100%;
  }
  .pulse-signal-wrap--interactive {
    cursor: crosshair;
  }
  .pulse-signal-wrap:focus-visible {
    outline: 1px solid rgba(167, 139, 250, 0.45);
    outline-offset: 2px;
  }
  .pulse-signal-line {
    vector-effect: non-scaling-stroke;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .pulse-signal-cross {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255, 255, 255, 0.22);
    pointer-events: none;
    transform: translateX(-50%);
    z-index: 2;
  }
  .pulse-signal-selection-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: repeating-linear-gradient(
      to bottom,
      rgba(251, 191, 36, 0.95) 0,
      rgba(251, 191, 36, 0.95) 4px,
      transparent 4px,
      transparent 8px
    );
    pointer-events: none;
    transform: translateX(-50%);
    z-index: 3;
  }
  .pulse-signal-selection-dot {
    position: absolute;
    bottom: 16px;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #fbbf24;
    box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.35);
    pointer-events: none;
    transform: translateX(-50%);
    z-index: 4;
  }
  .pulse-signal-selection-animated {
    transition: left 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .pulse-signal-tip {
    text-transform: none;
    white-space: normal;
    min-width: 110px;
  }
  .pulse-segment-moments-btn {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--pulse-surface-border-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 6px;
    color: ${theme.textMuted};
    cursor: pointer;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.04em;
    padding: 4px 8px;
    text-transform: uppercase;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .pulse-segment-moments-btn:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.06));
    color: ${theme.textSecondary};
  }
  .pulse-segment-moments-btn.is-active {
    background: rgba(251, 191, 36, 0.12);
    border-color: rgba(251, 191, 36, 0.35);
    color: ${theme.statusWarnText};
  }
  .pulse-segment-chart-surface {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.02));
  }
  .pulse-moment-card-enter {
    animation: pulseMomentCardEnter 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .pulse-moment-card-swap {
    animation: pulseMomentCardSwap 160ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .pulse-moment-card-pulse {
    animation: pulseMomentCardGlow 220ms ease-out;
  }
  @keyframes pulseMomentCardEnter {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes pulseMomentCardSwap {
    from {
      opacity: 0.78;
      transform: translateY(3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes pulseMomentCardGlow {
    0% {
      box-shadow: 0 0 0 0 rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse-signal-selection-animated {
      transition: none;
    }
    .pulse-moment-card-enter,
    .pulse-moment-card-swap,
    .pulse-moment-card-pulse {
      animation: none;
    }
  }
  .pulse-settings-gear-btn {
    align-items: center;
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--pulse-surface-border-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    color: ${theme.textMuted};
    cursor: pointer;
    display: inline-flex;
    flex-shrink: 0;
    height: 28px;
    justify-content: center;
    padding: 0;
    transition: background 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease;
    width: 28px;
  }
  .pulse-settings-gear-btn:hover {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.14);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.4);
    color: ${theme.accentText};
  }
  .pulse-settings-gear-btn:active {
    transform: scale(0.96);
  }
  .pulse-settings-gear-fab {
    transition: background 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 180ms ease, transform 160ms ease;
  }
  .pulse-settings-gear-fab:hover {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.16);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45);
    box-shadow: 0 0 0 3px rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.12);
    color: ${theme.accentText};
  }
  .pulse-settings-gear-fab:active {
    transform: scale(0.96);
  }
  .pulse-settings-gear-icon {
    display: block;
    transform-origin: 50% 50%;
    transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .pulse-settings-gear-btn:hover .pulse-settings-gear-icon,
  .pulse-settings-gear-fab:hover .pulse-settings-gear-icon {
    transform: rotate(60deg);
  }
  .pulse-settings-gear-btn:focus-visible,
  .pulse-settings-gear-fab:focus-visible {
    outline: 2px solid ${theme.accentStrong};
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse-settings-gear-btn,
    .pulse-settings-gear-fab,
    .pulse-settings-gear-icon {
      transition: none;
    }
    .pulse-settings-gear-btn:hover .pulse-settings-gear-icon,
    .pulse-settings-gear-fab:hover .pulse-settings-gear-icon {
      transform: none;
    }
    .pulse-settings-gear-btn:active,
    .pulse-settings-gear-fab:active {
      transform: none;
    }
  }
  .pulse-live-now-dot {
    animation: pulse-live-now 1.8s ease-in-out infinite;
  }
  @keyframes pulse-live-now {
    0%, 100% { opacity: 0.55; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.15); }
  }
  .pulse-past-vod-shell {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.035));
    border: 1px solid var(--pulse-surface-border-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 10px;
    overflow: hidden;
  }
  .pulse-past-vod-row {
    border-bottom: 1px solid var(--pulse-surface-border-subtle, rgba(255, 255, 255, 0.05));
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .pulse-past-vod-row-compact {
    min-width: 0;
  }
  .pulse-past-vod-meta-row .pulse-past-vod-status {
    font-size: 8px;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    text-transform: uppercase;
  }
  .pulse-past-vod-actions {
    align-items: stretch;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 4px;
    justify-content: center;
    width: 78px;
  }
  .pulse-past-vod-row-compact .pulse-past-vod-action {
    box-sizing: border-box;
    font-size: 9px;
    padding: 3px 6px;
    text-align: center;
    width: 100%;
  }
  .pulse-past-vod-row:last-child {
    border-bottom: 0;
  }
  .pulse-past-vod-row:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.05));
  }
  .pulse-past-vod-main {
    transition: color 0.15s ease;
  }
  .pulse-past-vod-row:hover .pulse-past-vod-title {
    color: ${theme.textPrimary};
  }
  .pulse-past-vod-action {
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.22);
    border-radius: 6px;
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.08);
    color: ${theme.accentText};
    cursor: pointer;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    padding: 4px 8px;
    text-transform: uppercase;
    transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
  }
  .pulse-past-vod-action:hover {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.14);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45);
    transform: translateY(-1px);
  }
  .pulse-past-vod-action-vod {
    color: ${theme.accentTextSubtle};
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.28);
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.12);
  }
  .pulse-past-vod-action-vod:hover {
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.5);
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.18);
  }
  .pulse-past-vod-row-current {
    background: rgba(239, 68, 68, 0.06);
    border: 1px solid rgba(248, 113, 113, 0.22);
    border-radius: 10px;
  }
  .pulse-past-vod-action-start {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.25);
    background: rgba(239, 68, 68, 0.12);
  }
  .pulse-past-vod-action-start:hover {
    border-color: rgba(252, 165, 165, 0.45);
    background: rgba(239, 68, 68, 0.18);
  }
  .pulse-past-vod-status {
    border: 1px solid transparent;
    border-radius: 999px;
    display: inline-flex;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.04em;
    padding: 2px 7px;
    text-transform: uppercase;
  }
  .pulse-past-vod-status-live { background: ${theme.statusErrorBg}; border-color: ${theme.statusErrorBorder}; color: ${theme.statusErrorText}; }
  .pulse-past-vod-status-synced { background: ${theme.statusOkBg}; border-color: ${theme.statusOkBorder}; color: ${theme.statusOkText}; }
  .pulse-past-vod-status-stats { background: ${theme.statusWarnBg}; border-color: ${theme.statusWarnBorder}; color: ${theme.statusWarnText}; }
  .pulse-past-vod-status-interrupted { background: ${theme.gameChipBg}; border-color: ${theme.gameChipBorder}; color: ${theme.gameChipText}; }
  .pulse-past-vod-status-unknown { background: ${theme.hoverFill}; border-color: ${theme.borderSubtle}; color: ${theme.textSecondary}; }
  .pulse-past-vod-footer {
    border-top: 1px solid var(--pulse-surface-border-subtle, rgba(255, 255, 255, 0.06));
    color: ${theme.accentTextSubtle};
    cursor: pointer;
    display: block;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.05em;
    padding: 10px 12px;
    text-align: center;
    text-transform: uppercase;
    transition: background 0.15s ease, color 0.15s ease;
    width: 100%;
    background: transparent;
    border-left: 0;
    border-right: 0;
    border-bottom: 0;
  }
  .pulse-past-vod-footer:hover {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.08);
    color: ${theme.accentText};
  }
  @keyframes pulse-hub-glow {
    0%, 100% {
      box-shadow: 0 0 0 1px rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.35), 0 4px 16px rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.12);
    }
    50% {
      box-shadow: 0 0 0 1px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.65), 0 6px 22px rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.28);
    }
  }
  @keyframes pulse-hub-shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  .pulse-analytics-hub-cta-wrap {
    box-sizing: border-box;
    min-width: 0;
  }
  .pulse-analytics-hub-cta {
    animation: pulse-hub-glow 2.5s ease-in-out infinite;
    appearance: none;
    background: linear-gradient(
      135deg,
      rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22) 0%,
      rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.14) 50%,
      rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22) 100%
    );
    background-size: 200% 200%;
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45);
    border-radius: 10px;
    box-sizing: border-box;
    color: ${theme.accentText};
    cursor: pointer;
    display: flex;
    justify-content: center;
    max-width: 100%;
    padding: 10px 12px;
    text-align: center;
    transition: transform 0.15s ease, border-color 0.15s ease;
    width: 100%;
  }
  .pulse-analytics-hub-cta:hover {
    animation: pulse-hub-glow 1.6s ease-in-out infinite, pulse-hub-shimmer 2.8s linear infinite;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.7);
    transform: translateY(-1px);
  }
  .pulse-analytics-header-link {
    transition: color 160ms ease, transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .pulse-analytics-header-link:hover {
    color: ${theme.accentText};
    transform: translateX(2px);
  }
  .pulse-analytics-header-link:active {
    transform: translateX(1px) scale(0.98);
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse-analytics-hub-cta,
    .pulse-analytics-header-link {
      animation: none;
      transition: none;
    }
    .pulse-analytics-hub-cta {
      background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.16);
    }
    .pulse-analytics-hub-cta:hover,
    .pulse-analytics-header-link:hover,
    .pulse-analytics-header-link:active {
      animation: none;
      transform: none;
    }
  }
  .pulse-settings-panel {
    display: grid;
    gap: 16px;
    padding: 2px 0 10px;
  }
  .pulse-settings-nav {
    align-items: center;
    display: flex;
    gap: 8px;
    justify-content: space-between;
    padding: 0 2px;
  }
  .pulse-settings-back {
    align-items: center;
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    color: ${theme.accentTextSubtle};
    cursor: pointer;
    display: inline-flex;
    font-size: 12px;
    font-weight: 650;
    gap: 6px;
    letter-spacing: 0.01em;
    line-height: 1;
    margin: 0 0 0 -6px;
    padding: 7px 10px;
    transition: background 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease;
  }
  .pulse-settings-back:hover {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.28);
    color: ${theme.accentText};
  }
  .pulse-settings-back:active {
    transform: scale(0.98);
  }
  .pulse-settings-back:focus-visible {
    outline: 2px solid ${theme.accentStrong};
    outline-offset: 2px;
  }
  .pulse-settings-back-arrow {
    display: inline-block;
    font-size: 13px;
    line-height: 1;
    transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .pulse-settings-back:hover .pulse-settings-back-arrow {
    transform: translateX(-3px);
  }
  .pulse-settings-back-label {
    display: inline-block;
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse-settings-back,
    .pulse-settings-back-arrow {
      transition: none;
    }
    .pulse-settings-back:hover .pulse-settings-back-arrow {
      transform: none;
    }
    .pulse-settings-back:active {
      transform: none;
    }
  }
  .pulse-settings-field {
    display: grid;
    gap: 6px;
  }
  .pulse-settings-field + .pulse-settings-field {
    margin-top: 2px;
  }
  .pulse-settings-connection-head {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: space-between;
  }
  .pulse-settings-connection-copy {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .pulse-settings-connection-title {
    color: ${theme.textPrimary};
    font-size: 14px;
    font-weight: 700;
    line-height: 1.25;
  }
  .pulse-settings-endpoint {
    background: var(--pulse-surface-input-bg, rgba(0, 0, 0, 0.22));
    border: 1px solid ${theme.border};
    border-radius: 8px;
    color: ${theme.textMuted};
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    line-height: 1.4;
    overflow: hidden;
    padding: 6px 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pulse-settings-status-ok {
    color: ${theme.liveSoft};
    font-size: 11px;
    font-weight: 600;
  }
  .pulse-settings-status-fail {
    color: ${theme.error};
    font-size: 11px;
    font-weight: 600;
  }
  .pulse-settings-cache-meta {
    background: var(--pulse-surface-input-bg, rgba(0, 0, 0, 0.18));
    border: 1px solid var(--pulse-surface-border-subtle, rgba(255, 255, 255, 0.06));
    border-radius: 8px;
    color: ${theme.textMuted};
    font-size: 11px;
    line-height: 1.45;
    padding: 8px 10px;
  }
  .pulse-settings-toggle-row + .pulse-settings-toggle-row {
    border-top: 1px solid var(--pulse-surface-border-subtle, rgba(255, 255, 255, 0.06));
    margin-top: 2px;
    padding-top: 10px;
  }
  .pulse-settings-label {
    color: ${theme.textPrimary};
    font-size: 12px;
    font-weight: 600;
  }
  .pulse-settings-hint {
    color: ${theme.textMuted};
    font-size: 11px;
    line-height: 1.45;
  }
  .pulse-segment-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pulse-segment-btn {
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 999px;
    color: ${theme.textSecondary};
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    padding: 5px 10px;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .pulse-segment-btn:hover:not(:disabled) {
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35);
    color: ${theme.accentText};
  }
  .pulse-segment-btn-active {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45);
    color: ${theme.accentText};
  }
  :host([data-pulse-color-scheme="light"]) .pulse-segment-btn-active {
    background: var(--pulse-accent-strong, #7c3aed);
    border-color: var(--pulse-accent-strong, #7c3aed);
    color: var(--pulse-on-accent, #fff);
  }
  .pulse-segment-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .pulse-segment-btn:focus-visible {
    outline: 2px solid ${theme.accent};
    outline-offset: 2px;
  }
  .pulse-settings-toggle-row {
    align-items: center;
    cursor: pointer;
    display: flex;
    gap: 10px;
    justify-content: space-between;
  }
  .pulse-settings-toggle {
    accent-color: var(--pulse-accent, #8b5cf6);
    appearance: none;
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    height: 18px;
    margin: 0;
    position: relative;
    width: 18px;
  }
  .pulse-settings-toggle:checked {
    background: var(--pulse-accent, #8b5cf6);
    border-color: var(--pulse-accent-strong, #7c3aed);
  }
  .pulse-settings-toggle:checked::after {
    border: solid var(--pulse-on-accent, #fff);
    border-width: 0 2px 2px 0;
    content: '';
    height: 9px;
    left: 6px;
    position: absolute;
    top: 2px;
    transform: rotate(45deg);
    width: 4px;
  }
  .pulse-primary-btn {
    appearance: none;
    background: var(--pulse-accent, #8b5cf6);
    border: 0;
    border-radius: 8px;
    color: var(--pulse-on-accent, #fff);
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    padding: 7px 12px;
  }
  .pulse-secondary-btn {
    appearance: none;
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 8px;
    color: ${theme.textPrimary};
    cursor: pointer;
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 600;
    padding: 7px 12px;
  }
  .pulse-link-btn {
    appearance: none;
    background: transparent;
    border: 0;
    color: ${theme.accentTextSubtle};
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    padding: 0;
  }
  .pulse-settings-input {
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 8px;
    color: ${theme.textPrimary};
    font-size: 12px;
    padding: 8px 10px;
    width: 100%;
  }
  .pulse-tab-fade { animation: tab-fade 0.2s ease both; }
  .pulse-mode-enter > * {
    animation: pulse-mode-content-enter 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .pulse-route-content-enter {
    animation: pulse-route-content-enter 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .pulse-themed-select-menu {
    animation: pulse-select-menu-enter 160ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    transform-origin: top right;
  }
  .pulse-themed-select-trigger {
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 6px;
    color: ${theme.textSecondary};
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .pulse-themed-select-trigger:hover:not(:disabled) {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.06));
    border-color: var(--pulse-surface-border-subtle, rgba(255, 255, 255, 0.16));
    color: ${theme.textPrimary};
  }
  .pulse-themed-select-trigger:focus-visible {
    outline: none;
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.55);
    color: ${theme.accentText};
  }
  .pulse-themed-select-trigger[aria-expanded="true"] {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.12);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45);
    color: ${theme.accentText};
  }
  .pulse-themed-select-trigger[aria-expanded="true"]:hover:not(:disabled) {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.16);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.55);
    color: ${theme.accentText};
  }
  .pulse-themed-select-trigger:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .pulse-themed-select-option {
    background: transparent;
    color: ${theme.textSecondary};
    transition: background 0.12s ease, color 0.12s ease;
  }
  .pulse-themed-select-option:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.06));
  }
  .pulse-themed-select-option[aria-selected="true"] {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.18);
    color: ${theme.accentText};
  }
  .pulse-themed-select-option[aria-selected="true"]:hover {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.24);
  }
  .pulse-themed-select-option[data-active="true"] {
    box-shadow: inset 0 0 0 1px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.55);
  }
  .pulse-themed-select-option:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.55);
  }
  .pulse-panel-view-enter {
    animation-duration: 0.2s;
    animation-fill-mode: both;
    animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  }
  .pulse-panel-view-settings { animation-name: pulse-view-enter-settings; }
  .pulse-panel-view-pulse { animation-name: pulse-view-enter-pulse; }
  .pulse-panel-view-stack {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .placement-sidebar .pulse-panel-view-stack {
    flex: 1;
    min-height: 0;
  }
  .pulse-shell,
  .pulse-panel-body,
  .pulse-panel-scroll {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .pulse-shell::-webkit-scrollbar,
  .pulse-panel-body::-webkit-scrollbar,
  .pulse-panel-scroll::-webkit-scrollbar {
    display: none;
    height: 0;
    width: 0;
  }
  .pulse-sidebar-tabs {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: ${theme.radiusButton}px;
    border: 1px solid var(--pulse-surface-border, rgba(255, 255, 255, 0.08));
    background: var(--pulse-surface-input-bg, var(--pulse-surface-panel-elevated, rgba(0, 0, 0, 0.25)));
  }
  .pulse-sidebar-tab {
    flex: 1;
    border: 0;
    border-radius: 7px;
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    color: ${theme.textSecondary};
    background: transparent;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .pulse-sidebar-tab.active {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.28);
    color: ${theme.accentText};
  }
  :host([data-pulse-color-scheme="light"]) .pulse-sidebar-tab.active {
    background: var(--pulse-accent-strong, #7c3aed);
    color: var(--pulse-on-accent, #fff);
  }
  .pulse-sidebar-tab:not(.active):hover {
    color: ${theme.textPrimary};
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.06));
  }
  .pulse-sidebar-tab:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .pulse-sidebar-tabs-compact {
    background: var(--pulse-surface-input-bg, var(--pulse-surface-panel-elevated, rgba(255, 255, 255, 0.08)));
    border: 1px solid var(--pulse-surface-border, transparent);
    gap: 2px;
    height: 30px;
    padding: 2px;
    width: 100%;
  }
  .pulse-sidebar-tabs-compact .pulse-sidebar-tab {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.06em;
    padding: 4px 0;
  }
  .pulse-sidebar-header-tabs.pulse-shell {
    animation: none;
    backdrop-filter: none;
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    overflow: visible;
    pointer-events: none;
  }
  .pulse-sidebar-header-row {
    align-items: center;
    display: flex;
    gap: 4px;
    height: 100%;
    padding: 0 6px;
    pointer-events: none;
    width: 100%;
  }
  .pulse-sidebar-header-edge {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 4px;
    color: ${theme.textPrimary};
    cursor: pointer;
    display: inline-flex;
    flex-shrink: 0;
    height: 28px;
    justify-content: center;
    pointer-events: auto;
    width: 28px;
  }
  .pulse-sidebar-header-edge-wide {
    width: 28px;
  }
  .pulse-sidebar-header-edge-active {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.28);
    color: ${theme.accentText};
  }
  :host([data-pulse-color-scheme="light"]) .pulse-sidebar-header-edge-active {
    background: var(--pulse-accent-strong, #7c3aed);
    color: var(--pulse-on-accent, #fff);
  }
  .pulse-sidebar-header-edge:hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.1));
  }
  .pulse-sidebar-header-tabs .pulse-sidebar-tabs {
    flex: 1;
    min-width: 0;
    pointer-events: auto;
  }
  .pulse-sidebar-header-tabs .pulse-sidebar-tabs-compact {
    background: var(--pulse-surface-input-bg, var(--pulse-surface-panel-elevated, #eef0f6));
    border: 1px solid var(--pulse-surface-border, #c8c8d0);
    gap: 2px;
    height: 28px;
    padding: 2px;
  }
  .pulse-panel-body-compact {
    min-width: 0;
  }
  .pulse-panel-body-compact .pulse-section-card,
  .pulse-panel-body-compact section {
    min-width: 0;
  }
  .pulse-sidebar-header-tabs .pulse-sidebar-tabs-compact .pulse-sidebar-tab {
    padding: 3px 0;
  }
  .placement-sidebar.pulse-shell {
    background: ${theme.bgCanvas};
    border-radius: 0;
    border: 0;
    box-shadow: none;
  }
  .placement-sidebar.pulse-sidebar-panel.pulse-shell {
    animation: none;
    backdrop-filter: none;
    overflow: hidden;
  }
  .placement-sidebar.pulse-sidebar-panel .pulse-panel-body {
    height: 100%;
    overflow: auto;
  }
  .sidebar-chat-only .pulse-panel-body {
    display: none !important;
  }
  .sidebar-chat-only.pulse-shell {
    background: transparent !important;
    backdrop-filter: none !important;
    border: none !important;
    box-shadow: none !important;
    overflow: visible !important;
    pointer-events: none;
  }
  .sidebar-chat-only .pulse-sidebar-tabs-wrap {
    pointer-events: auto;
  }
  .mode-mini.placement-sidebar.pulse-shell {
    animation: none;
    backdrop-filter: none;
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    overflow: hidden;
  }
  .mode-mini.placement-right.pulse-shell,
  .mode-mini.placement-bottom.pulse-shell {
    animation: none;
    backdrop-filter: none;
    background: transparent;
    border: 0;
    box-shadow: none;
    overflow: hidden;
  }
  .pulse-mini-dock-main:hover {
    background: ${theme.accentSurface} !important;
    border-color: ${theme.borderAccent} !important;
  }
  .pulse-mini-dock .pulse-mini-dock-main:focus-visible {
    outline: 2px solid rgba(167, 139, 250, 0.55);
    outline-offset: 2px;
  }
  .pulse-mini-dock button[title]:not(.pulse-mini-dock-main):hover {
    background: var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.06));
    color: ${theme.textPrimary};
  }
  .pulse-collapsed-pill:hover {
    background: ${theme.accentSurface} !important;
    border-color: ${theme.borderAccent} !important;
    transform: translateY(-1px);
  }
  .mode-collapsed.placement-sidebar.pulse-shell {
    animation: none;
    backdrop-filter: none;
    background: transparent;
    border: 0;
    box-shadow: none;
    overflow: visible;
  }
  .sc-chart-root .sc-chart-plot {
    transition: opacity 0.2s ease;
  }
  .sc-emote-plot-line {
    transition: opacity 0.2s ease, stroke-opacity 0.2s ease;
  }
  .sc-hover-line,
  .sc-playhead-line {
    will-change: transform;
  }
  @media (prefers-reduced-motion: reduce) {
    .sc-chart-root .sc-chart-plot,
    .sc-emote-plot-line {
      transition: none !important;
    }
  }
`

let stylesInjected = false

export function injectStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  const existing = document.getElementById('streamclone-pulse-styles')
  if (existing) {
    stylesInjected = true
    return
  }
  const style = document.createElement('style')
  style.id = 'streamclone-pulse-styles'
  style.textContent = shadowStyles
  document.head.appendChild(style)
  stylesInjected = true
}
