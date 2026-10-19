import {
  GAMES_PLAYED_ART_WIDTH_PX as ART_W,
  GAMES_PLAYED_CHIP_GAP_PX as CHIP_GAP,
  GAMES_PLAYED_HIT_TARGET_HEIGHT_PX as CHIP_H,
  GAMES_PLAYED_HIT_TARGET_PX as CHIP_W,
  GAMES_PLAYED_ICON_SIZE_PX as ART_H,
} from './gamesPlayedLayout.ts'
import { theme } from './theme.ts'

/**
 * Static styles of the overlay panel's components.
 *
 * These were inline React style objects. As CSS they ship in shadow.css, not
 * the size-gated content script, so an element only carries its class; inline
 * style stays for values that change at runtime. The rules come last in the
 * stylesheet and match the old inline values exactly, so nothing looks different.
 */
export function panelComponentCss(): string {
  return `
  .pulse-sidebar-tabs-wrap { flex-shrink: 0; padding: 8px; }
  .pulse-state-block { background: #1f1f27; border-radius: 12px; margin-top: 16px; padding: 16px; }
  .pulse-state-title { font-size: 18px; margin: 0 0 10px; }
  .pulse-state-text { color: #b7b7c6; font-size: 13px; line-height: 1.35; margin: 0 0 14px; }
  .pulse-warming-count { color: #8b8ba0; }
  .pulse-progress-track { background: #33333d; border-radius: 999px; height: 8px; margin-bottom: 10px; overflow: hidden; }
  .pulse-progress-fill { background: var(--pulse-accent-soft, #a78bfa); border-radius: 999px; display: block; height: 100%; }
  .pulse-track-prompt { background: #1f1f27; border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35); border-radius: 12px; margin-bottom: 14px; padding: 14px; }
  .pulse-footer-actions { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 14px; }
  .pulse-primary-button { background: var(--pulse-accent-strong, #7c3aed); border: 0; border-radius: 10px; color: var(--pulse-on-accent, #fff); cursor: pointer; font-weight: 800; min-height: 44px; padding: 11px 14px; }
  .pulse-secondary-button { background: #2b2b32; border: 1px solid #3f3f50; border-radius: 10px; color: #fafafc; cursor: pointer; font-weight: 800; min-height: 44px; padding: 11px 14px; }
  .pulse-text-button-large { background: transparent; border: 0; color: var(--pulse-accent-soft, #c4b5fd); cursor: pointer; font-size: 14px; font-weight: 800; padding: 8px 0; }
  .pulse-soft-stale-banner { background: rgba(212, 160, 23, 0.12); border: 1px solid rgba(212, 160, 23, 0.35); border-radius: 8px; color: #e8d48a; font-size: 12px; line-height: 1.35; margin: 0 0 10px; padding: 8px 10px; }
  .pulse-error-block { background: #1f1f27; border-radius: 12px; padding: 16px; }
  .pulse-error-title { color: #f87171; font-size: 18px; margin: 0 0 10px; }
  .pulse-refresh-error { align-items: center; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.28); border-radius: 8px; color: #fcd34d; display: flex; flex-wrap: wrap; font-size: 11px; font-weight: 700; gap: 8px; justify-content: space-between; margin-bottom: 10px; padding: 7px 9px; }
  .pulse-notice { background: #2a2440; border: 1px solid #3f3f50; border-radius: 10px; color: var(--pulse-accent-soft, #c4b5fd); font-size: 12px; font-weight: 700; margin: 14px 0 0; padding: 10px 12px; }
  .pulse-notice-warn { background: rgba(249,115,22,0.12); border-color: rgba(249,115,22,0.35); color: #fdba74; }
  .pulse-notice-ok { background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.35); color: #86efac; }
  .pulse-vod-state { background: #1f1f27; border: 1px solid #3f3f50; border-radius: 12px; padding: 14px; }
  .pulse-vod-state-warn { background: rgba(245, 158, 11, 0.08); border-color: rgba(251, 191, 36, 0.38); }
  .pulse-vod-state-title { font-size: 15px; font-weight: 700; line-height: 1.3; margin: 0 0 6px; }
  .pulse-vod-state-link { align-items: center; box-sizing: border-box; display: flex; font-size: 13px; justify-content: center; padding: 10px 6px; text-decoration: none; white-space: nowrap; }
  .pulse-vod-state-support { background: none; border: 0; color: #a1a1b5; cursor: pointer; font: inherit; font-size: 11px; margin: 10px 0 0; padding: 0; text-decoration: underline; }

  .pulse-header-main { flex: 1 1 180px; min-width: 0; width: 100%; }
  .pulse-header-main-sidebar { flex: 0 0 auto; min-width: 0; width: 100%; }
  .pulse-header-actions { align-items: flex-end; display: flex; flex-direction: column; flex-shrink: 0; gap: 8px; }
  .pulse-header-actions-sidebar { align-items: stretch; display: flex; flex-direction: column; gap: 10px; width: 100%; }
  .pulse-tracking-pill { background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22); border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45); border-radius: 999px; color: var(--pulse-accent-soft, #c4b5fd); display: inline-block; font-size: 10px; font-weight: 900; letter-spacing: 0.04em; padding: 4px 10px; text-transform: uppercase; }
  .pulse-tracking-pill-full { align-self: flex-start; background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.16); border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35); border-radius: 999px; color: var(--pulse-accent-soft, #c4b5fd); display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.04em; padding: 4px 10px; text-align: center; text-transform: uppercase; width: fit-content; }
  .pulse-track-streamer { background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1); border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.3); border-radius: ${theme.radiusButton}px; color: var(--pulse-accent-ink, #ddd6fe); cursor: pointer; font-size: 11px; font-weight: 900; padding: 8px 12px; text-transform: uppercase; }
  .pulse-track-streamer-full { background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1); border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.3); border-radius: ${theme.radiusButton}px; color: var(--pulse-accent-ink, #ddd6fe); cursor: pointer; font-size: 11px; font-weight: 900; padding: 10px 12px; text-align: center; text-transform: uppercase; width: 100%; }
  .pulse-auto-update-label { align-items: center; color: ${theme.textSecondary}; display: flex; font-size: 11px; font-weight: 600; gap: 8px; }
  .pulse-auto-update-label-full { align-items: center; color: ${theme.textSecondary}; display: flex; font-size: 11px; font-weight: 600; gap: 8px; justify-content: space-between; width: 100%; }
  .pulse-auto-update-switch { border: 0; border-radius: 999px; cursor: pointer; flex-shrink: 0; height: 22px; position: relative; width: 36px; }
  .pulse-auto-update-knob { background: #fff; border-radius: 999px; height: 18px; position: absolute; top: 2px; width: 18px; }
  .pulse-header-icons { display: flex; flex-wrap: wrap; gap: 6px; }
  .pulse-header-icons-full { display: grid; gap: 6px; grid-template-columns: repeat(3, minmax(0, 1fr)); width: 100%; }
  .pulse-header-icon-button { align-items: center; background: transparent; border: 0; color: ${theme.textMuted}; cursor: pointer; display: inline-flex; font-size: 11px; font-weight: 700; justify-content: center; min-height: 32px; min-width: 44px; padding: 4px 8px; }
  .pulse-header-icon-button-full { align-items: center; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: ${theme.textMuted}; cursor: pointer; display: inline-flex; font-size: 11px; font-weight: 700; justify-content: center; min-height: 40px; padding: 8px 6px; text-align: center; width: 100%; }

  .pulse-clips-header { align-items: center; display: flex; gap: 8px; justify-content: space-between; }
  .pulse-clips-heading { color: ${theme.textSecondary}; font-size: 12px; font-weight: 700; letter-spacing: 0; margin: 0; }
  .pulse-clips-controls { display: flex; gap: 4px; }
  .pulse-clips-rail { display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; padding: 10px 0 2px; scrollbar-width: none; }
  .pulse-clips-rail > div { flex: 0 0 min(232px, 88%); min-width: 0; scroll-snap-align: start; }
  .pulse-clip-spike-card { color: ${theme.textPrimary}; display: block; border-radius: 6px; text-decoration: none; }
  .pulse-clip-thumb { aspect-ratio: 16 / 9; background: #18181b; position: relative; border-radius: 6px; overflow: hidden; }
  .pulse-clip-image { display: block; height: 100%; object-fit: cover; width: 100%; }
  .pulse-clip-image-fallback { background: #18181b; height: 100%; width: 100%; }
  .pulse-clip-duration { background: rgba(0,0,0,0.8); border-radius: 3px; bottom: 6px; color: #fafafc; font-size: 10px; font-weight: 600; padding: 2px 5px; position: absolute; right: 6px; }
  .pulse-clip-body { display: grid; gap: 4px; padding: 8px 2px 2px; }
  .pulse-clip-title { display: -webkit-box; font-size: 12px; font-weight: 600; line-height: 1.4; height: 2.8em; overflow-wrap: anywhere; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .pulse-clip-views { color: ${theme.textMuted}; font-size: 10px; font-weight: 500; }

  .pulse-games { display: grid; gap: 4px; margin-bottom: 2px; min-width: 0; width: 100%; }
  .pulse-games-header { align-items: center; display: flex; gap: 6px; min-width: 0; width: 100%; }
  .pulse-games-label-shell { align-items: baseline; display: flex; gap: 6px; flex: 1 1 auto; min-width: 0; overflow: hidden; }
  .pulse-games-name { color: ${theme.textPrimary}; flex: 0 1 auto; font-size: 10px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pulse-games-meta { color: ${theme.textMuted}; flex-shrink: 0; font-size: 9px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pulse-games-label { color: ${theme.textMuted}; font-size: 10px; font-weight: 800; }
  .pulse-games-trail { align-items: center; display: flex; gap: 6px; min-width: 0; flex-shrink: 0; margin-left: auto; }
  .pulse-games-count { color: ${theme.textSecondary}; font-size: 10px; font-variant-numeric: tabular-nums; font-weight: 800; white-space: nowrap; }
  .pulse-games-empty-copy { color: ${theme.textMuted}; font-size: 9px; font-weight: 600; line-height: 1.35; margin: 0; }
  .pulse-games-nav { display: flex; gap: 3px; }
  .pulse-games-arrow { align-items: center; background: ${theme.panel}; border: 1px solid ${theme.border}; border-radius: 6px; color: ${theme.textPrimary}; cursor: pointer; display: flex; font-size: 16px; height: 24px; justify-content: center; line-height: 1; padding: 0; width: 24px; }
  .pulse-games-arrow:disabled { cursor: default; opacity: 0.35; }
  .pulse-games-timeline { min-width: 0; overflow: hidden; }
  .pulse-games-track { align-items: center; display: flex; gap: ${CHIP_GAP}px; min-height: ${CHIP_H + 4}px; min-width: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; padding: 2px 3px; scrollbar-width: none; width: 100%; }
  .pulse-games-item { flex: 0 0 ${CHIP_W}px; position: relative; }
  .pulse-games-card { align-items: center; background: ${theme.panel}; border: 1px solid ${theme.border}; border-radius: 8px; box-sizing: border-box; cursor: pointer; display: flex; height: ${CHIP_H}px; justify-content: center; overflow: hidden; padding: 2px; position: relative; text-align: center; transition: background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease; width: ${CHIP_W}px; }
  .pulse-games-card-active { background: rgba(139, 92, 246, 0.14); border: 1px solid ${theme.borderAccent}; box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.18), 0 5px 16px rgba(0,0,0,0.24); transform: translateY(-2px) scale(1.02); }
  /* After the active rule: a clipped game keeps its dashed edge while highlighted. */
  .pulse-games-card-clipped { border-style: dashed; }
  .pulse-games-art { border-radius: 7px; display: block; height: ${ART_H}px; overflow: hidden; position: relative; width: ${ART_W}px; }
  .pulse-games-art-image { border-radius: 7px; box-sizing: border-box; display: block; height: ${ART_H}px; inset: 0; object-fit: cover; position: absolute; width: ${ART_W}px; }
  .pulse-games-art-fallback { align-items: center; background: linear-gradient(155deg, rgba(139,92,246,0.20), rgba(15,23,42,0.94)); border: 1px dashed ${theme.borderAccent}; border-radius: 7px; box-sizing: border-box; color: ${theme.textPrimary}; display: flex; font-size: 14px; font-weight: 900; height: ${ART_H}px; inset: 0; justify-content: center; letter-spacing: 0.08em; position: absolute; width: ${ART_W}px; }
  .pulse-games-card-name { background: linear-gradient(180deg, transparent, rgba(0,0,0,0.92) 42%); bottom: 0; color: #fafafc; font-size: 9px; font-weight: 850; left: 0; line-height: 1.15; overflow: hidden; padding: 10px 3px 3px; pointer-events: none; position: absolute; right: 0; text-overflow: ellipsis; text-shadow: 0 1px 2px rgba(0,0,0,0.9); white-space: nowrap; }

  .pulse-seven-tv-panel { background: rgba(17, 17, 23, 0.72); border: 1px solid rgba(103, 232, 249, 0.1); border-radius: 10px; margin-top: 8px; overflow: hidden; }
  .pulse-seven-tv-header { align-items: center; display: flex; gap: 4px; min-width: 0; }
  .pulse-seven-tv-clear { background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(167, 139, 250, 0.3); border-radius: 6px; color: #ddd6fe; cursor: pointer; flex: 0 0 auto; font-size: 9px; font-weight: 800; min-height: 25px; padding: 3px 7px; }
  .pulse-seven-tv-label { color: ${theme.textMuted}; flex-shrink: 0; font-size: 10px; font-weight: 800; }
  .pulse-seven-tv-preview { align-items: center; display: inline-flex; flex: 1; gap: 5px; min-width: 0; }
  .pulse-seven-tv-preview-emote { align-items: center; background: rgba(255, 255, 255, 0.035); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 5px; display: inline-flex; flex-shrink: 0; height: 22px; justify-content: center; width: 22px; }
  .pulse-seven-tv-chevron { color: ${theme.accentSoft}; flex-shrink: 0; font-size: 11px; font-weight: 900; margin-left: auto; transition: transform .18s cubic-bezier(.2,0,0,1); }
  .pulse-seven-tv-chevron.pulse-seven-tv-still { transition: none; }
  .pulse-emote-picker-grid { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
  .pulse-seven-tv-chip { align-items: center; background: rgba(255, 255, 255, 0.045); border-color: rgba(255, 255, 255, 0.12); border-style: solid; border-width: 1px; border-radius: 999px; color: ${theme.textPrimary}; cursor: pointer; display: inline-flex; flex: 0 1 auto; gap: 5px; justify-content: center; min-height: 30px; min-width: 58px; padding: 3px 8px 3px 5px; }
  .pulse-seven-tv-chip-compact { min-height: 28px; min-width: 54px; padding: 3px 7px 3px 4px; }
  .pulse-seven-tv-chip-disabled { cursor: not-allowed; opacity: 0.48; }
  .pulse-seven-tv-chip-count { color: ${theme.textSecondary}; font-size: 10px; font-variant-numeric: tabular-nums; font-weight: 800; line-height: 1; }
  .pulse-seven-tv-swatch { border-radius: 999px; flex-shrink: 0; height: 7px; width: 7px; }
  .pulse-seven-tv-more { background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(167, 139, 250, 0.35); border-radius: 999px; color: #c4b5fd; cursor: pointer; font-size: 9px; font-weight: 800; justify-self: center; padding: 5px 10px; }

  .pulse-mini-dock { align-items: center; display: flex; gap: 8px; height: 100%; min-height: 52px; padding: 6px 8px; width: 100%; }
  .pulse-mini-dock-sidebar { gap: 6px; min-height: 0; padding: 8px 10px; }
  /* No font: the old inline font (theme.font) had no size, so browsers dropped it. */
  .pulse-mini-dock-main { align-items: center; background: ${theme.panel}; border: 1px solid ${theme.border}; border-radius: ${theme.radiusPanel}px; color: ${theme.textPrimary}; cursor: pointer; display: flex; flex: 1; gap: 10px; min-width: 0; padding: 8px 12px; text-align: left; transition: border-color 0.15s ease, background 0.15s ease; }
  .pulse-mini-brand-mark { align-items: center; background: ${theme.accent}; border-radius: 10px; display: inline-flex; flex-shrink: 0; height: 34px; justify-content: center; min-width: 34px; }
  .pulse-mini-brand-mark-compact { border-radius: 8px; height: 28px; min-width: 28px; }
  .pulse-mini-brand-dot { background: ${theme.textPrimary}; border-radius: 999px; display: block; height: 12px; width: 12px; }
  .pulse-mini-brand-dot-compact { height: 10px; width: 10px; }
  .pulse-mini-brand { flex-shrink: 0; font-size: 13px; font-weight: 800; letter-spacing: -0.01em; }
  .pulse-mini-status { align-items: center; color: ${theme.textMuted}; display: inline-flex; flex-shrink: 1; font-size: 11px; font-weight: 600; gap: 6px; min-width: 0; }
  .pulse-mini-status-live { color: ${theme.liveSoft}; font-weight: 700; }
  .pulse-mini-status-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pulse-mini-dot { background: ${theme.textMuted}; border-radius: 999px; display: inline-block; flex-shrink: 0; height: 7px; width: 7px; }
  .pulse-mini-dot-live { background: ${theme.live}; }
  .pulse-mini-heat { align-items: flex-end; display: flex; flex: 1 1 96px; gap: 3px; height: 28px; justify-content: flex-end; margin-left: auto; max-width: 168px; min-width: 72px; }
  .pulse-mini-heat-bar { border-radius: 3px; display: block; flex: 1 1 4px; max-width: 8px; min-width: 3px; transform-origin: bottom center; }
  .pulse-mini-heat-ghost { background: rgba(139, 92, 246, 0.14); border-radius: 3px; display: block; flex: 1 1 4px; height: 22%; max-width: 8px; min-width: 3px; }
  .pulse-mini-dock-actions { align-items: center; display: flex; flex-shrink: 0; gap: 2px; }

  .pulse-settings-footer { flex-shrink: 0; padding: 0 10px 10px; }
  .pulse-settings-bottom-bar { align-items: center; background: rgba(17, 17, 23, 0.96); border: 1px solid ${theme.borderAccent}; border-radius: 8px; box-sizing: border-box; color: ${theme.textSecondary}; cursor: pointer; display: flex; font-size: 11px; font-weight: 800; gap: 8px; justify-content: space-between; margin-top: 0; min-height: 44px; padding: 9px 11px; text-align: left; width: 100%; }
`
}
