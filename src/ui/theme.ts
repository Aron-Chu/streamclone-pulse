/** Streamclone obsidian theme tokens (matches web app + Figma handoff). */
export const accentTokens = {
  accent: 'var(--pulse-accent, #8b5cf6)',
  accentStrong: 'var(--pulse-accent-strong, #7c3aed)',
  accentSoft: 'var(--pulse-accent-soft, #c4b5fd)',
  accentInk: 'var(--pulse-accent-ink, #ddd6fe)',
  onAccent: 'var(--pulse-on-accent, #ffffff)',
  borderAccent: 'var(--pulse-accent-border, rgba(139, 92, 246, 0.35))',
} as const

export const theme = {
  bg: '#18181b',
  bgCanvas: '#111117',
  panel: '#262633',
  panelElevated: '#2a2440',
  panelGlass: 'rgba(17, 17, 23, 0.92)',
  textPrimary: '#fafafc',
  textSecondary: '#a1a1b2',
  textMuted: '#8b8ba0',
  accent: accentTokens.accent,
  accentStrong: accentTokens.accentStrong,
  accentSoft: accentTokens.accentSoft,
  accent2: '#22d3ee',
  rank1: '#f97316',
  live: '#22c55e',
  liveSoft: '#86efac',
  border: '#3f3f50',
  borderAccent: accentTokens.borderAccent,
  error: '#f87171',
  /** Channels of `error`, for token-derived rgba() tints. */
  errorRgb: '248, 113, 113',
  warning: '#fdba74',
  radiusPanel: 14,
  radiusButton: 9,
  radiusPill: 13,
  font: 'Inter, ui-sans-serif, system-ui, sans-serif',
  onAccent: accentTokens.onAccent,
  accentInk: accentTokens.accentInk,
} as const

// The Supporter destination mark draws once beside its title; reduced motion
// shows the finished stroke. Keep explanatory comments out of the shipped CSS.
export const shadowStyles = `
  @keyframes pulse-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes pulse-in-right {
    from { opacity: 0; transform: translateY(calc(-50% + 8px)) scale(0.98); }
    to { opacity: 1; transform: translateY(-50%) scale(1); }
  }
  @keyframes pulse-in-bottom {
    from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.98); }
    to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
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
  @keyframes pulse-select-menu-enter {
    from { opacity: 0; transform: translateY(-3px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes pulse-view-enter-settings {
    from{opacity:0;transform:translateX(5px)}to{opacity:1;transform:translateX(0)}
  }
  @keyframes pulse-view-enter-pulse {
    from{opacity:0;transform:translateX(-5px)}to{opacity:1;transform:translateX(0)}
  }
  @keyframes pulse-selection-band {
    from{opacity:0}to{opacity:1}
  }
  @keyframes pulse-coverage-wait {
    0%, 100% { border-color: rgba(167, 139, 250, 0.35); }
    50% { border-color: rgba(167, 139, 250, 0.75); }
  }
  @keyframes pulse-status-dot {
    0%, 100% { opacity: 0.58; transform: scale(0.86); }
    50% { opacity: 1; transform: scale(1.16); }
  }
  @keyframes pulse-hub-cta-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse-hub-cta-sheen {
    0% { opacity: 0; transform: translateX(-135%) skewX(-18deg); }
    18% { opacity: 0.72; }
    100% { opacity: 0; transform: translateX(430%) skewX(-18deg); }
  }
  @keyframes pulse-moment-saved {
    0% { opacity: 0.72; transform: scale(0.96); }
    55% { opacity: 1; transform: scale(1.08); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes pulse-moment-feedback {
    from { opacity: 0; transform: translateY(-3px); }
    to { opacity: 1; transform: translateY(0); }
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
  .pulse-status-pill-tracking .pulse-status-pill-dot {
    animation: live-ping 1.8s ease-in-out infinite;
  }
  .pulse-status-pill-syncing .pulse-status-pill-dot {
    animation: pulse-status-dot 1.4s ease-in-out infinite;
  }
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
  .pulse-moment-row-button:focus:not(:focus-visible),
  .pulse-moment-row-button:active {
    outline: none !important;
    box-shadow: none !important;
  }
  .pulse-moment-row-button:focus-visible {
    outline: 2px solid rgba(var(--pulse-accent-light-rgb, 196, 181, 253), 0.95) !important;
    outline-offset: 2px;
    box-shadow: 0 0 0 1px rgba(17, 17, 23, 0.95) !important;
  }
  .pulse-moment-row-button .pulse-moment-row {
    border: none;
    box-shadow: inset 0 0 0 1px transparent;
    background: rgba(255, 255, 255, 0.03);
    transition: background var(--pulse-motion-interactive) var(--pulse-ease-standard),
      box-shadow var(--pulse-motion-interactive) var(--pulse-ease-standard);
  }
  .pulse-moment-accent{background:rgba(255,255,255,.12);transition:background var(--pulse-motion-interactive) var(--pulse-ease-standard)}
  .pulse-moment-row-button:hover .pulse-moment-row {
    box-shadow: inset 0 0 0 1px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35) !important;
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.08) !important;
  }
  .pulse-moment-row-button:hover .pulse-moment-accent{background:rgba(var(--pulse-accent-light-rgb,167,139,250),.75)}
  .pulse-moment-accent-selected{background:var(--pulse-accent-soft,#c4b5fd) !important}
  .pulse-moment-row-selected {
    box-shadow: inset 0 0 0 1px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45) !important;
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.14) !important;
  }
  .pulse-seven-tv-toggle:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  .pulse-seven-tv-toggle:focus-visible,.pulse-seven-tv-more:focus-visible,.pulse-seven-tv-chip:focus-visible{outline:2px solid rgba(var(--pulse-accent-light-rgb,196,181,253),.95);outline-offset:2px}
  .pulse-seven-tv-chip {
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }
  .pulse-seven-tv-chip:hover:not(.pulse-seven-tv-chip-active) {
    background: rgba(255, 255, 255, 0.06) !important;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35) !important;
    transform: translateY(-1px);
  }
  .pulse-seven-tv-chip-active:hover {
    transform: translateY(-1px);
    filter: brightness(1.1);
  }
  .pulse-seven-tv-chip-disabled:hover {
    background: inherit !important;
    border-color: inherit !important;
    transform: none !important;
  }
  .pulse-overview-chart:focus-visible,
  .pulse-overview-chart [data-chart-scrubber]:focus-visible {
    outline: none !important;
  }
  .pulse-chart-legend-chip {
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease,
      color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
  }
  .pulse-chart-legend-chip:hover {
    background: rgba(255, 255, 255, 0.08) !important;
    border-color: rgba(255, 255, 255, 0.22) !important;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
    color: ${theme.textPrimary} !important;
    transform: translateY(-1px);
  }
  .pulse-chart-legend-chip-focused {
    background: rgba(255, 255, 255, 0.1) !important;
    border-color: rgba(255, 255, 255, 0.28) !important;
    color: ${theme.textPrimary} !important;
  }
  .pulse-chart-legend-chip-focused:hover {
    background: rgba(255, 255, 255, 0.14) !important;
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
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.55) !important;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32), inset 2px 0 0 currentColor;
    transform: translateY(-1px) scale(1.06);
  }
  .pulse-chart-expand-btn {
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
  }
  .pulse-chart-expand-btn:hover {
    background: rgba(255, 255, 255, 0.1) !important;
    border-color: rgba(255, 255, 255, 0.22) !important;
    transform: translateY(-1px);
  }
  .pulse-chart-expand-btn:focus-visible {
    outline: 2px solid rgba(103, 232, 249, 0.95) !important;
    outline-offset: 2px !important;
  }
  .pulse-chart-expand-btn-active:hover {
    background: rgba(139, 92, 246, 0.2) !important;
    border-color: rgba(167, 139, 250, 0.5) !important;
  }
  .pulse-workspace .pulse-section-card {
    background: transparent !important;
    border: 0 !important;
    border-top: 1px solid rgba(255,255,255,.09) !important;
    border-radius: 0 !important;
    padding: 16px 4px !important;
    margin-bottom: 0 !important;
    min-width: 0;
  }
  .pulse-workspace [data-pulse-section-heading] h2,
  .pulse-workspace [data-pulse-section-heading] h3 { letter-spacing: 0 !important; }
  .pulse-clips-section { min-width: 0; padding: 14px 4px; border-top: 1px solid rgba(255,255,255,.09); }
  .pulse-clips-count { color: ${theme.textMuted}; font-variant-numeric: tabular-nums; margin-left: 6px; }
  .pulse-clip-control {
    width: 28px; height: 28px; display: inline-grid; place-items: center;
    padding: 0; border: 0; border-radius: 4px;
    background: transparent; color: ${theme.textSecondary}; font-size: 16px;
    cursor: pointer; transition: background .14s ease, color .14s ease, transform .14s ease;
  }
  .pulse-clip-control:hover:not(:disabled) { background: rgba(255,255,255,.1); color: ${theme.textPrimary}; }
  .pulse-clip-control:active:not(:disabled) { transform: translateY(1px); }
  .pulse-clip-control:disabled { opacity: .35; cursor: default; }
  .pulse-clip-control:focus-visible, .pulse-clips-rail:focus-visible { outline: 2px solid ${theme.accentSoft}; outline-offset: 2px; }
  .pulse-clips-rail { overscroll-behavior-x: contain; scroll-padding: 2px; }
  .pulse-clips-rail::-webkit-scrollbar { display: none; }
  .pulse-clips-rail > div { padding: 2px; box-sizing: border-box; }
  .pulse-clip-spike-card{transition:color .16s ease,transform .16s ease}
  .pulse-clip-spike-card:hover,.pulse-clip-spike-card:focus-visible{color:var(--pulse-accent-ink,#ddd6fe)!important;transform:translateY(-2px)}
  .pulse-clip-spike-card:focus-visible{outline:2px solid rgba(var(--pulse-accent-light-rgb,196,181,253),.95);outline-offset:2px}
  .pulse-recap-analytics-cta {
    transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  }
  .pulse-recap-analytics-cta:hover:not(:disabled) {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.92) !important;
    box-shadow: 0 6px 18px rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.35);
    transform: translateY(-1px);
  }
  .pulse-recap-highlight-btn {
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .pulse-recap-highlight-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.07) !important;
    border-color: rgba(255, 255, 255, 0.22) !important;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24);
    transform: translateY(-1px);
  }
  .pulse-recap-highlight-btn-selected:hover {
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.55) !important;
  }
  .pulse-action-chip {
    -webkit-tap-highlight-color: transparent;
    min-height: 40px;
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .pulse-action-chip:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08) !important;
    border-color: rgba(255, 255, 255, 0.22) !important;
    transform: translateY(-1px);
  }
  .pulse-action-chip-primary:hover:not(:disabled) {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.2) !important;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45) !important;
    box-shadow: 0 4px 12px rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22);
  }
  .pulse-action-chip-primary:hover:not(:disabled) .pulse-hub-arrow {
    transform: translate(2px, -2px);
  }
  .pulse-action-chip-primary:active {
    transform: translateY(0) scale(0.985);
  }
  .pulse-action-chip:active:not(:disabled) {
    transform: translateY(0) scale(0.985);
  }
  .pulse-action-chip-primary:focus-visible {
    outline: 2px solid rgba(103, 232, 249, 0.95);
    outline-offset: 2px;
  }
  .pulse-action-chip:focus-visible {
    outline: 2px solid rgba(var(--pulse-accent-light-rgb, 196, 181, 253), 0.95);
    outline-offset: 2px;
  }
  .pulse-library-peek-cta {
    align-items: center;
    appearance: none;
    background: linear-gradient(135deg, rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.2), rgba(17, 17, 23, 0.72));
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.42);
    border-radius: 8px;
    box-shadow: 0 5px 16px rgba(0, 0, 0, 0.18);
    color: var(--pulse-accent-ink, #ddd6fe);
    cursor: pointer;
    display: inline-flex;
    flex: 0 0 auto;
    font: inherit;
    font-size: 11px;
    font-weight: 850;
    gap: 6px;
    justify-content: center;
    min-height: 36px;
    padding: 7px 9px;
    transition: transform 150ms ease, border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
    white-space: nowrap;
  }
  .pulse-library-peek-cta:hover {
    background: linear-gradient(135deg, rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.3), rgba(17, 17, 23, 0.82));
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.7);
    box-shadow: 0 7px 20px rgba(0, 0, 0, 0.24);
    transform: translateY(-1px);
  }
  .pulse-library-peek-cta:active {
    transform: translateY(0);
  }
  .pulse-library-peek-cta:focus-visible {
    outline: 2px solid rgba(103, 232, 249, 0.95);
    outline-offset: 2px;
  }
  .pulse-library-peek-cta-arrow {
    color: var(--pulse-accent-light, #c4b5fd);
    font-size: 14px;
    line-height: 1;
    transition: transform 150ms ease;
  }
  .pulse-library-peek-cta:hover .pulse-library-peek-cta-arrow {
    transform: translateX(2px);
  }
  .pulse-action-chip:disabled {
    cursor: not-allowed;
    opacity: 0.58;
    transform: none !important;
  }
  .pulse-moment-actions {
    width: min(100%, 420px);
  }
  .pulse-moment-actions .pulse-action-chip {
    min-height: 40px;
  }
  .pulse-moment-bookmark-button[data-moment-save-state="saved"] {
    border-color: rgba(52, 211, 153, 0.46) !important;
    color: #a7f3d0 !important;
  }
  .pulse-moment-bookmark-button[data-moment-save-state="saved"] .pulse-moment-bookmark-icon {
    animation: pulse-moment-saved 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
    color: #6ee7b7;
  }
  .pulse-moment-action-feedback {
    animation: pulse-moment-feedback 160ms ease-out both;
  }
  .pulse-moment-action-error {
    animation: pulse-moment-feedback 160ms ease-out both;
  }
  .pulse-analytics-hub-cta {
    align-items: flex-start;
    appearance: none;
    background: linear-gradient(
      135deg,
      rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22) 0%,
      rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.14) 50%,
      rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22) 100%
    );
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.42);
    border-radius: 9px;
    box-sizing: border-box;
    color: var(--pulse-accent-ink, #ddd6fe);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    justify-content: center;
    min-height: 44px;
    overflow: hidden;
    padding: 10px 12px;
    position: relative;
    isolation: isolate;
    text-align: left;
    width: 100%;
    -webkit-tap-highlight-color: transparent;
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .pulse-analytics-hub-cta::before {
    background: linear-gradient(
      105deg,
      transparent 0%,
      rgba(255, 255, 255, 0.04) 38%,
      rgba(255, 255, 255, 0.24) 50%,
      rgba(255, 255, 255, 0.04) 62%,
      transparent 100%
    );
    content: '';
    inset: -30% auto -30% -35%;
    opacity: 0;
    pointer-events: none;
    position: absolute;
    transform: translateX(-135%) skewX(-18deg);
    width: 42%;
    z-index: 0;
  }
  .pulse-analytics-hub-cta > * {
    position: relative;
    z-index: 1;
  }
  .pulse-analytics-hub-cta:hover::before,
  .pulse-analytics-hub-cta:focus-visible::before {
    animation: pulse-hub-cta-sheen 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .pulse-analytics-hub-cta:hover:not(:disabled) {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.2) !important;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.7) !important;
    box-shadow: 0 5px 16px rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.18);
  }
  .pulse-analytics-hub-cta:active {
    transform: translateY(0) scale(0.985);
  }
  [data-pulse-hub-cta="true"] {
    animation: pulse-hub-cta-in 220ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
  }
  [data-pulse-hub-cta="true"]::before {
    animation: pulse-hub-cta-sheen 680ms cubic-bezier(0.22, 1, 0.36, 1) 150ms both;
  }
  .pulse-chart-zoom-button {
    -webkit-tap-highlight-color: transparent;
    min-height: 24px;
    min-width: 24px;
    transition: transform 0.14s ease, background 0.14s ease, border-color 0.14s ease,
      box-shadow 0.14s ease, opacity 0.14s ease;
  }
  .pulse-chart-zoom-button:hover:not(:disabled) {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.24) !important;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.58) !important;
    box-shadow: 0 3px 10px rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.2);
    transform: translateY(-1px);
  }
  .pulse-chart-zoom-button:active:not(:disabled) {
    transform: translateY(0) scale(0.96);
  }
  .pulse-chart-zoom-button:focus-visible {
    outline: 2px solid rgba(103, 232, 249, 0.95);
    outline-offset: 2px;
  }
  .pulse-chart-zoom-reset {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 44px;
    min-width: 44px;
    font-variant-numeric: tabular-nums;
  }
  .pulse-chart-zoom-controls { animation: pulse-zoom-arrive 140ms ease-out; }
  @keyframes pulse-zoom-arrive { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
  .pulse-chart-zoom-button:disabled {
    cursor: default;
    opacity: 0.48;
  }
  .pulse-chart-zoom-reset:hover:not(:disabled) {
    color: ${theme.textSecondary} !important;
  }
  .pulse-chart-rail-track {
    transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
  }
  .pulse-chart-rail-track:hover:not([aria-disabled="true"]) {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.06) !important;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.5) !important;
  }
  .pulse-chart-rail-track:focus-visible {
    outline: 2px solid rgba(103, 232, 249, 0.95);
    outline-offset: 2px;
    box-shadow: 0 0 0 3px rgba(17, 17, 23, 0.92);
  }
  .pulse-chart-rail-track[data-chart-interacting="true"] {
    border-color: rgba(var(--pulse-accent-light-rgb, 196, 181, 253), 0.72) !important;
    box-shadow: 0 0 0 2px rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.14);
  }
  .pulse-chart-rail-thumb {
    transition: filter 0.16s ease;
  }
  .pulse-chart-rail-track:hover:not([aria-disabled="true"]) .pulse-chart-rail-thumb {
    filter: brightness(1.08);
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
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease,
      color 0.15s ease, filter 0.12s ease, opacity 0.12s ease;
  }
  .pulse-secondary-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06) !important;
    border-color: rgba(255, 255, 255, 0.2) !important;
    color: ${theme.textPrimary} !important;
    transform: translateY(-1px);
  }
  .pulse-emote-hover-wrap {
    align-items: center;
    display: inline-flex;
    flex: 0 0 auto;
    position: relative;
    vertical-align: middle;
  }
  .pulse-emote-hover-wrap:focus-visible {
    outline: 2px solid rgba(var(--pulse-accent-light-rgb, 196, 181, 253), 0.9);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .pulse-emote-hover-preview {
    align-items: center;
    background: rgba(17, 17, 23, 0.96);
    border: 1px solid rgba(167, 139, 250, 0.35);
    border-radius: 10px;
    box-sizing: border-box;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
    display: grid;
    gap: 2px;
    bottom: calc(100% + 8px);
    left: 50%;
    max-width: min(180px, calc(100vw - 16px));
    min-width: 88px;
    opacity: 0;
    padding: 8px;
    pointer-events: none;
    position: absolute;
    transform: translateX(-50%);
    transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;
    visibility: hidden;
    white-space: normal;
    overflow-wrap: anywhere;
    z-index: 20;
  }
  .pulse-emote-hover-preview > img {
    max-width: 100%;
  }
  .pulse-emote-hover-preview > * {
    min-width: 0;
    max-width: 100%;
  }
  .pulse-emote-hover-wrap[data-tooltip-open="true"] .pulse-emote-hover-preview {
    opacity: 1;
    justify-items: center;
    transform: translateX(-50%);
    visibility: visible;
  }
  .pulse-inspector-emote-row {
    border-radius: 8px;
    padding: 2px 4px;
    transition: background 0.15s ease;
  }
  .pulse-inspector-emote-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .pulse-sparkline-wrap {
    position: relative;
  }
  .pulse-sparkline-tooltip {
    background: rgba(17, 17, 23, 0.96);
    border: 1px solid rgba(167, 139, 250, 0.3);
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
    -webkit-tap-highlight-color: transparent;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: ${theme.textMuted};
    cursor: pointer;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.04em;
    min-height: 30px;
    padding: 4px 8px;
    text-transform: uppercase;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .pulse-segment-moments-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
    color: ${theme.textSecondary};
  }
  .pulse-segment-moments-btn:focus-visible {
    outline: 2px solid rgba(var(--pulse-accent-light-rgb, 196, 181, 253), 0.95);
    outline-offset: 2px;
  }
  .pulse-segment-moments-btn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .pulse-segment-moments-btn.is-active {
    background: rgba(251, 191, 36, 0.12);
    border-color: rgba(251, 191, 36, 0.35);
    color: #fde68a;
  }
  .pulse-segment-chart-surface {
    background: rgba(255, 255, 255, 0.02);
  }
  .pulse-moment-inspector-card,.pulse-moment-card-swap{animation:row-rise 120ms cubic-bezier(.22,1,.36,1) both}
  .pulse-moment-selection-card,.pulse-moment-card-enter{animation:pulse-in 180ms cubic-bezier(.22,1,.36,1) both;transform-origin:top center}
  .pulse-moment-card-pulse{animation:row-rise 180ms cubic-bezier(.22,1,.36,1) both}
  .pulse-moment-card-exit{animation:pulse-card-out 180ms cubic-bezier(.4,0,.2,1) both;overflow:hidden;pointer-events:none}
  @keyframes pulse-card-out{0%{opacity:1;transform:translateY(0);max-height:220px}60%{opacity:0;transform:translateY(-4px)}100%{opacity:0;transform:translateY(-4px);max-height:0;margin-top:0}}
  [data-chart-selection-band="preview"]{animation:pulse-selection-band 90ms ease-out both}
  [data-chart-selection-band="locked"]{animation:pulse-selection-band 180ms cubic-bezier(.22,1,.36,1) both}
  @media (prefers-reduced-motion: reduce) {
    [data-pulse-hub-cta="true"] {
      animation: none !important;
    }
    .pulse-analytics-hub-cta,
    .pulse-analytics-hub-cta::before {
      animation: none !important;
      transition: none !important;
    }
    .pulse-analytics-hub-cta:hover,
    .pulse-analytics-hub-cta:active {
      transform: none !important;
    }
    .pulse-moment-bookmark-button[data-moment-save-state="saved"] .pulse-moment-bookmark-icon,
    .pulse-moment-action-feedback,
    .pulse-moment-action-error {
      animation: none !important;
    }
    .pulse-clip-spike-card,.pulse-clip-control{transform:none!important;transition:none!important}
    .pulse-hub-arrow {
      transition: none !important;
    }
    .pulse-chart-zoom-button {
      transition: none !important;
    }
    .pulse-chart-zoom-controls { animation: none !important; }
    .pulse-chart-rail-track,
    .pulse-chart-rail-thumb {
      transition: none !important;
    }
    .pulse-signal-selection-animated {
      transition: none;
    }
    .pulse-emote-hover-preview {
      transition: none;
    }
  }
  .pulse-settings-gear-btn {
    align-items: center;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: ${theme.textMuted};
    cursor: pointer;
    display: inline-flex;
    flex-shrink: 0;
    height: 32px;
    justify-content: center;
    padding: 0;
    width: 32px;
  }
  .pulse-settings-gear-btn:hover:not(:disabled) {
    background: rgba(139, 92, 246, 0.14);
    border-color: rgba(167, 139, 250, 0.35);
    color: #ddd6fe;
  }
  .pulse-settings-gear-btn:focus-visible {
    outline: 2px solid rgba(var(--pulse-accent-light-rgb, 196, 181, 253), 0.95);
    outline-offset: 2px;
  }
  .pulse-past-vod-shell {
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    overflow: hidden;
  }
  .pulse-past-vod-row {
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .pulse-past-vod-row-compact {
    min-width: 0;
  }
  .pulse-past-vod-meta-row .pulse-past-vod-status {
    font-size: 9px;
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
    background: rgba(255, 255, 255, 0.05);
  }
  .pulse-past-vod-main {
    transition: color 0.15s ease;
  }
  .pulse-past-vod-row:hover .pulse-past-vod-title {
    color: #fff;
  }
  .pulse-past-vod-action {
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.22);
    border-radius: 6px;
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.08);
    color: var(--pulse-accent-ink, #ddd6fe);
    cursor: pointer;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    min-height: 30px;
    padding: 4px 8px;
    text-transform: uppercase;
    transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
  }
  .pulse-past-vod-action:hover:not(:disabled) {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.14);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45);
    transform: translateY(-1px);
  }
  .pulse-past-vod-action:focus-visible {
    outline: 2px solid rgba(var(--pulse-accent-light-rgb, 196, 181, 253), 0.95);
    outline-offset: 2px;
  }
  .pulse-past-vod-action:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    transform: none;
  }
  .pulse-past-vod-action-vod {
    color: var(--pulse-accent-soft, #c4b5fd);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.28);
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.12);
  }
  .pulse-past-vod-action-vod:hover:not(:disabled) {
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.5);
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.18);
  }
  .pulse-past-vod-action-start {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.25);
    background: rgba(239, 68, 68, 0.12);
  }
  .pulse-past-vod-action-start:hover:not(:disabled) {
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
  .pulse-past-vod-status-live { background: rgba(239, 68, 68, 0.12); border-color: rgba(248, 113, 113, 0.25); color: #fecaca; }
  .pulse-past-vod-status-synced { background: rgba(16, 185, 129, 0.12); border-color: rgba(52, 211, 153, 0.25); color: #6ee7b7; }
  .pulse-past-vod-status-stats { background: rgba(245, 158, 11, 0.12); border-color: rgba(251, 191, 36, 0.25); color: #fcd34d; }
  .pulse-past-vod-status-interrupted { background: rgba(249, 115, 22, 0.12); border-color: rgba(251, 146, 60, 0.25); color: #fdba74; }
  .pulse-past-vod-status-unknown { background: rgba(113, 113, 122, 0.12); border-color: rgba(161, 161, 170, 0.25); color: #d4d4d8; }
  .pulse-past-vod-footer {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    color: var(--pulse-accent-soft, #c4b5fd);
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
    color: var(--pulse-accent-ink, #ede9fe);
  }
  .pulse-settings-panel {
    display: grid;
    gap: 9px;
    min-width: 0;
    padding: 2px 0 10px;
  }
  .pulse-settings-nav {
    align-items: center;
    display: flex;
    gap: 8px;
    justify-content: space-between;
    padding: 0 2px;
  }
  .pulse-settings-nav h1 {
    color: ${theme.textPrimary};
    font-size: 13px;
    margin: 0;
  }
  .pulse-settings-connection {
    align-items: center;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.085);
    border-radius: 9px;
    display: flex;
    gap: 9px;
    min-width: 0;
    padding: 8px 9px;
  }
  .pulse-settings-status-dot {
    background: ${theme.textMuted};
    border-radius: 999px;
    flex: none;
    height: 7px;
    width: 7px;
  }
  .pulse-settings-status-dot-connected { background: ${theme.liveSoft}; }
  .pulse-settings-status-dot-unreachable { background: ${theme.error}; }
  .pulse-settings-connection-copy { display: grid; flex: 1 1 auto; min-width: 0; }
  .pulse-settings-connection-copy strong {
    color: ${theme.textPrimary};
    font-size: 11.5px;
    font-weight: 700;
  }
  .pulse-settings-connection-copy small { color: ${theme.textMuted}; font-size: 10.5px; }
  .pulse-settings-retest {
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid ${theme.border};
    border-radius: 7px;
    color: ${theme.textSecondary};
    cursor: pointer;
    font-size: 13px;
    height: 26px;
    padding: 0;
    width: 28px;
  }
  .pulse-settings-quick,
  .pulse-settings-release-preview {
    background: rgba(255, 255, 255, 0.018);
    border: 1px solid rgba(255, 255, 255, 0.085);
    border-radius: 10px;
    min-width: 0;
  }
  .pulse-settings-quick { padding: 9px 10px 2px; }
  .pulse-settings-overlay-workspace .pulse-settings-quick {
    background: none;
    border: 0;
    border-radius: 0;
    padding: 8px 2px;
  }
  .pulse-quick-group-title {
    color: ${theme.textSecondary};
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0;
    margin: 16px 0 4px;
  }
  .pulse-settings-overlay-workspace .pulse-settings-control-block {
    padding: 12px 0;
  }
  .pulse-settings-overlay-workspace .pulse-link-btn {
    min-height: 32px;
    min-width: 32px;
    text-align: left;
  }
  .pulse-settings-overlay-workspace .pulse-settings-retest {
    width: 32px;
    height: 32px;
    flex: none;
  }
  .pulse-settings-section-heading {
    align-items: center;
    display: flex;
    justify-content: space-between;
    padding-bottom: 4px;
  }
  .pulse-settings-section-heading h2 {
    color: ${theme.textPrimary};
    font-size: 10px;
    margin: 0;
    text-transform: uppercase;
  }
  .pulse-settings-status-fail {
    color: ${theme.error};
  }
  .pulse-settings-field {
    display: grid;
    gap: 5px;
  }
  .pulse-settings-control-block {
    border-top: 1px solid rgba(255, 255, 255, 0.055);
    padding: 9px 0;
  }
  .pulse-accent-picker,
  .pulse-placement-picker {
    display: grid;
    gap: 5px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .pulse-accent-picker { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pulse-density-picker {
    display: grid;
    gap: 5px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .pulse-accent-choice,
  .pulse-placement-choice,
  .pulse-density-choice {
    align-items: center;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid ${theme.border};
    border-radius: 7px;
    color: ${theme.textSecondary};
    display: flex;
    font-size: 10.5px;
    gap: 5px;
    justify-content: center;
    padding: 6px 5px;
    transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease;
  }
  .pulse-accent-choice:hover,.pulse-placement-choice:hover,.pulse-density-choice:hover{transform:translateY(-1px)}
  .pulse-accent-choice-active,
  .pulse-placement-choice-active,
  .pulse-density-choice-active {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.13);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.46);
    color: var(--pulse-accent-ink, #ddd6fe);
  }
  .pulse-accent-swatch {
    border-radius: 999px;
    flex: none;
    height: 8px;
    width: 8px;
  }
  /* Selected marker for compact pickers, matching PulseThemedSelect. Styled
     here rather than inline so it follows the stylesheet like every sibling. */
  .pulse-choice-check { flex: none; font-size: 9px; line-height: 1; margin-left: 2px; }
  .pulse-placement-icon {
    border: 1px solid currentColor;
    border-radius: 2px;
    display: inline-block;
    height: 10px;
    opacity: 0.75;
    width: 13px;
  }
  .pulse-placement-icon[data-placement="sidebar"] { box-shadow: inset -3px 0 currentColor; }
  .pulse-placement-icon[data-placement="right"] { box-shadow: 3px 0 currentColor; }
  .pulse-placement-icon[data-placement="bottom"] { box-shadow: 0 3px currentColor; }
  .pulse-settings-label {
    color: ${theme.textPrimary};
    font-size: 12px;
  }
  .pulse-settings-hint {
    color: ${theme.textMuted};
    font-size: 11px;
  }
  .pulse-settings-release-preview { overflow: hidden; }
  .pulse-settings-release-preview summary {
    align-items: center;
    cursor: pointer;
    display: grid;
    gap: 8px;
    grid-template-columns: auto minmax(0, 1fr) auto;
    list-style: none;
    padding: 9px 10px;
  }
  .pulse-settings-release-chevron{transition:transform 160ms ease}
  .pulse-settings-release-preview[open] .pulse-settings-release-chevron{transform:rotate(90deg)}
  .pulse-settings-release-preview summary::-webkit-details-marker { display: none; }
  .pulse-settings-release-version {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.16);
    border-radius: 999px;
    color: var(--pulse-accent-ink, #ddd6fe);
    font-size: 10px;
    font-weight: 700;
    padding: 3px 6px;
  }
  .pulse-settings-release-title { display: grid; }
  .pulse-settings-release-title small {
    color: ${theme.textMuted};
    font-size: 11px;
  }
  .pulse-settings-release-body {
    border-top: 1px solid rgba(255, 255, 255, 0.055);
    display: grid;
    gap: 8px;
    padding: 9px 10px 10px;
  }
  .pulse-settings-release-body ul {
    color: ${theme.textMuted};
    font-size: 11px;
    line-height: 1.45;
    margin: 0;
    padding-left: 16px;
  }
  .pulse-settings-open-all {
    align-items: center;
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1);
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.32);
    border-radius: 9px;
    color: var(--pulse-accent-ink, #ddd6fe);
    cursor: pointer;
    display: flex;
    font-size: 10.5px;
    justify-content: space-between;
    padding: 8px 10px;
    width: 100%;
  }
   .pulse-settings-supporter-cta {
    align-items: flex-start;
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.18);
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.6);
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    gap: 9px;
    padding: 12px 10px;
    text-align: left;
     width: 100%;
   }
   .pulse-settings-supporter-mark {
     flex: none;
     margin-top: 1px;
   }
   .pulse-settings-supporter-mark path {
     animation: pulse-peak-draw 420ms ease-out 1 both;
     stroke-dasharray: 40;
     stroke-dashoffset: 40;
   }
   @keyframes pulse-peak-draw {
     to { stroke-dashoffset: 0; }
   }
  .pulse-settings-supporter-text { display: grid; gap: 2px; min-width: 0; }
  .pulse-settings-supporter-text strong { color: ${theme.textPrimary}; font-size: 13px; }
  .pulse-settings-supporter-text small { color: ${theme.textSecondary}; font-size: 10px; line-height: 1.4; }
  .pulse-settings-supporter-cta > [aria-hidden]:last-child { align-self: center; color: var(--pulse-accent-ink, #ddd6fe); margin-left: auto; }
  .pulse-settings-panel button:not(:disabled):hover,.pulse-settings-release-preview>summary:hover{border-color:var(--pulse-accent-light,#a78bfa);filter:brightness(1.15)}
  .pulse-settings-panel :is(button,input,select,summary):focus-visible{outline:2px solid var(--pulse-accent-light,#a78bfa);outline-offset:3px}
  .pulse-settings-toggle-row {
    align-items: center;
    display: flex;
    gap: 10px;
    justify-content: space-between;
  }
  .pulse-settings-toggle-row > div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .pulse-settings-toggle {
    appearance: none;
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 999px;
    cursor: pointer;
    flex: none;
    height: 19px;
    margin: 0;
    position: relative;
    transition: background 150ms ease, border-color 150ms ease;
    width: 34px;
  }
  .pulse-settings-toggle:checked {
    background: var(--pulse-accent, #8b5cf6);
    border-color: var(--pulse-accent-strong, #7c3aed);
  }
  .pulse-settings-toggle:checked::after {
    background: var(--pulse-on-accent, #fff);
    left: 17px;
  }
  .pulse-settings-toggle::after {
    background: ${theme.textMuted};
    border-radius: 999px;
    content: '';
    height: 13px;
    left: 2px;
    position: absolute;
    top: 2px;
    transition: background 150ms ease, left 150ms cubic-bezier(0.22, 1, 0.36, 1);
    width: 13px;
  }
  .pulse-primary-btn {
    appearance: none;
    background: var(--pulse-accent-strong, #7c3aed);
    border: 0;
    border-radius: 8px;
    color: var(--pulse-on-accent, #fff);
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    padding: 7px 12px;
    transition: filter 120ms ease, opacity 120ms ease;
  }
  .pulse-primary-btn:hover {
    filter: brightness(1.08);
  }
  .pulse-primary-btn:focus-visible {
    outline: 2px solid var(--pulse-accent-soft, #c4b5fd);
    outline-offset: 2px;
  }
  .pulse-primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: none;
  }
  .pulse-link-btn {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--pulse-accent-soft, #c4b5fd);
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    padding: 0;
  }
  .pulse-tab-fade { animation: tab-fade 0.2s ease both; }
  .pulse-themed-select-menu {
    animation: pulse-select-menu-enter 160ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    transform-origin: top right;
  }
  .pulse-themed-select-trigger {
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .pulse-themed-select-chevron{transition:transform 120ms ease}
  .pulse-themed-select-chevron[data-open="true"]{transform:rotate(180deg)}
  .pulse-themed-select-trigger:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06) !important;
    border-color: rgba(255, 255, 255, 0.16) !important;
    color: ${theme.textPrimary} !important;
  }
  .pulse-themed-select-trigger:focus-visible {
    outline: 2px solid ${theme.accentSoft};
    outline-offset: 2px;
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1) !important;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.55) !important;
    color: ${theme.accentInk} !important;
  }
  .pulse-themed-select-option {
    transition: background 0.12s ease, color 0.12s ease;
  }
  .pulse-themed-select-option:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06) !important;
  }
  .pulse-themed-select-option[data-active="true"] {
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
  .pulse-panel-body {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .pulse-shell::-webkit-scrollbar,
  .pulse-panel-body::-webkit-scrollbar {
    display: none;
    height: 0;
    width: 0;
  }
  .pulse-sidebar-tabs {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: ${theme.radiusButton}px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.25);
  }
  .pulse-sidebar-tab {
    flex: 1;
    border: 0;
    border-radius: 7px;
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.04em;
    min-height: 32px;
    text-transform: uppercase;
    cursor: pointer;
    color: ${theme.textSecondary};
    background: transparent;
    transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease,
      transform 0.15s ease;
  }
  .pulse-sidebar-tab:focus-visible {
    outline: 2px solid rgba(var(--pulse-accent-light-rgb, 196, 181, 253), 0.95);
    outline-offset: -2px;
  }
  .pulse-sidebar-tab.active {
    background: ${theme.accentStrong};
    color: ${theme.onAccent};
  }
  .pulse-sidebar-tab:not(.active):hover:not(:disabled) {
    color: ${theme.textPrimary};
    background: rgba(255, 255, 255, 0.06);
  }
  .pulse-sidebar-tab:active:not(:disabled) {
    transform: scale(0.98);
  }
  .pulse-sidebar-tab:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .pulse-sidebar-tabs-compact {
    background: rgba(255, 255, 255, 0.08);
    border: 0;
    gap: 2px;
    height: 34px;
    padding: 2px;
    width: 100%;
  }
  .pulse-sidebar-tabs-compact .pulse-sidebar-tab {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.06em;
    min-height: 28px;
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
    color: #efeff1;
    cursor: pointer;
    display: inline-flex;
    flex-shrink: 0;
    height: 32px;
    justify-content: center;
    pointer-events: auto;
    width: 32px;
  }
  .pulse-sidebar-header-edge-wide {
    width: 32px;
  }
  .pulse-sidebar-header-edge-active {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.35);
    color: ${theme.textPrimary};
  }
  .pulse-sidebar-header-edge:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .pulse-sidebar-header-edge:focus-visible {
    outline: 2px solid rgba(var(--pulse-accent-light-rgb, 196, 181, 253), 0.95);
    outline-offset: 2px;
  }
  .pulse-sidebar-header-tabs .pulse-sidebar-tabs {
    flex: 1;
    min-width: 0;
    pointer-events: auto;
  }
  .pulse-sidebar-header-tabs .pulse-sidebar-tabs-compact {
    background: rgba(255, 255, 255, 0.08);
    border: 0;
    gap: 2px;
    height: 34px;
    padding: 2px;
  }
  .pulse-sidebar-header-tabs .pulse-sidebar-tabs-compact .pulse-sidebar-tab {
    min-height: 28px;
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
    flex: 1;
    height: auto;
    overflow: auto;
    min-height: 0;
    /* Keep chart/rail wheel gestures from chaining into the Twitch page. */
    overscroll-behavior: contain;
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
    background: rgba(42, 36, 64, 0.92) !important;
    border-color: rgba(167, 139, 250, 0.35) !important;
  }
  .pulse-mini-dock .pulse-mini-dock-main:focus-visible {
    outline: 2px solid rgba(167, 139, 250, 0.55);
    outline-offset: 2px;
  }
  .pulse-mini-dock button[title]:not(.pulse-mini-dock-main):hover {
    background: rgba(255, 255, 255, 0.06);
    color: ${theme.textPrimary};
  }
  .pulse-collapsed-pill:hover {
    background: rgba(42, 36, 64, 0.96) !important;
    border-color: rgba(167, 139, 250, 0.4) !important;
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
  :host {
    --pulse-motion-fast: 100ms;
    --pulse-motion-interactive: 140ms;
    --pulse-motion-data: 180ms;
    --pulse-ease-out: cubic-bezier(0.2, 0, 0, 1);
    --pulse-ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  }
  .pulse-settings-bottom-bar {
    -webkit-tap-highlight-color: transparent;
    padding-bottom: max(9px, env(safe-area-inset-bottom)) !important;
    transition: background var(--pulse-motion-interactive) var(--pulse-ease-standard),
      border-color var(--pulse-motion-fast) var(--pulse-ease-standard),
      color var(--pulse-motion-fast) var(--pulse-ease-standard),
      box-shadow var(--pulse-motion-fast) var(--pulse-ease-standard),
      transform var(--pulse-motion-fast) var(--pulse-ease-out);
  }
  .pulse-settings-bottom-bar:hover {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.14) !important;
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.52) !important;
    color: ${theme.textPrimary} !important;
  }
  .pulse-settings-bottom-bar:active {
    transform: translateY(1px);
  }
  .pulse-settings-bottom-bar:focus-visible {
    outline: 2px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.9);
    outline-offset: 2px;
    box-shadow: 0 0 0 1px rgba(17, 17, 23, 0.95);
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse-chart-overview-path,
    .pulse-chart-detail-path {
      transition: none !important;
    }
    .pulse-settings-bottom-bar {
      transform: none !important;
      transition: none !important;
    }
    .pulse-settings-supporter-mark path {
      animation: none !important;
      stroke-dashoffset: 0 !important;
    }
  }
  /* Density layout tokens and adjustments */
  .pulse-density-compact,
  [data-pulse-density="compact"] {
    --pulse-density-pad: 8px;
    --pulse-density-gap: 6px;
  }
  .pulse-density-compact .pulse-section-card,
  [data-pulse-density="compact"] .pulse-section-card {
    padding: 10px 12px !important;
    gap: 8px !important;
    margin-bottom: 8px !important;
  }
  .pulse-density-compact .pulse-moment-row,
  [data-pulse-density="compact"] .pulse-moment-row {
    padding: 3px 6px !important;
    gap: 6px !important;
  }
  .pulse-density-compact .pulse-settings-control-block,
  [data-pulse-density="compact"] .pulse-settings-control-block {
    margin-bottom: 5px !important;
  }
  .pulse-density-compact .pulse-settings-toggle-row,
  [data-pulse-density="compact"] .pulse-settings-toggle-row {
    padding: 3px 0 !important;
  }
  .pulse-density-compact .pulse-settings-quick,
  [data-pulse-density="compact"] .pulse-settings-quick {
    gap: 8px !important;
  }
  .pulse-density-compact .pulse-panel-body > * + *,
  [data-pulse-density="compact"] .pulse-panel-body > * + * {
    margin-top: 6px !important;
  }
  .pulse-density-compact [data-chart-viewport-controls],
  [data-pulse-density="compact"] [data-chart-viewport-controls] {
    margin-bottom: 4px !important;
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
