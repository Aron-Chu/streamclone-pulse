import { theme } from '../ui/theme.ts'

/**
 * Styles for the extension's own settings page.
 *
 * Kept out of `src/ui/theme.ts` on purpose: that stylesheet is inlined into the
 * Twitch content script, so page-only chrome (app shell, section nav, wide
 * layouts, and the settings controls that only the host page renders) would ship
 * to every Twitch tab for nothing.
 *
 * Viewport media queries are legitimate here because this file styles a real
 * top-level page, not a ~320px panel embedded in someone else's layout.
 */
const hostStyles = `
  .pulse-settings-supporter-banner {
    align-items: center;
    background: linear-gradient(100deg, rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.3), rgba(45, 212, 191, 0.2));
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.7);
    border-radius: 8px;
    color: ${theme.textPrimary};
    cursor: pointer;
    display: flex;
    font-family: inherit;
    gap: 10px;
    letter-spacing: 0;
    margin: 0 0 18px;
    min-height: 58px;
    padding: 13px 14px;
    text-align: left;
    width: 100%;
  }
  .pulse-settings-supporter-banner:hover { border-color: var(--pulse-accent-light, #a78bfa); filter: brightness(1.08); }
  .pulse-settings-supporter-banner:focus-visible { outline: 2px solid var(--pulse-accent-light, #a78bfa); outline-offset: 3px; }
  .pulse-settings-supporter-banner-mark {
    align-items: center;
    background: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.2);
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.42);
    border-radius: 7px;
    color: var(--pulse-accent-ink, #ddd6fe);
    display: inline-flex;
    flex: none;
    font-size: 15px;
    height: 28px;
    justify-content: center;
    width: 28px;
  }
  .pulse-settings-supporter-banner-copy { display: grid; gap: 2px; min-width: 0; }
  .pulse-settings-supporter-banner-copy strong { font-size: 14px; font-weight: 800; }
  .pulse-settings-supporter-banner-copy small { color: ${theme.textSecondary}; font-size: 12px; line-height: 1.4; }
  .pulse-settings-supporter-banner-arrow { align-items: center; color: var(--pulse-accent-ink, #ddd6fe); display: inline-flex; font-size: 12px; font-weight: 700; gap: 6px; margin-left: auto; white-space: nowrap; }
  @media (max-width: 480px) {
    .pulse-settings-supporter-banner { flex-wrap: wrap; }
    .pulse-settings-supporter-banner-copy { flex: 1; }
    .pulse-settings-supporter-banner-arrow { margin-left: 38px; }
  }
  .pulse-account-link-code { font-size: 22px; font-weight: 600; letter-spacing: .12em; user-select: all; padding: 12px 0; }
  .pulse-account-link-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .pulse-account-link-actions button, .pulse-account-link-actions a { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 8px 14px; border: 1px solid ${theme.border}; border-radius: 9px; background: ${theme.panel}; color: ${theme.textPrimary}; font: inherit; font-weight: 700; cursor: pointer; transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease, transform 140ms ease; }
  .pulse-account-link-actions button:hover:not(:disabled), .pulse-account-link-actions a:hover { border-color: ${theme.accentSoft}; background: ${theme.panelElevated}; color: ${theme.textPrimary}; transform: translateY(-1px); }
  .pulse-account-link-actions button:active:not(:disabled), .pulse-account-link-actions a:active { transform: translateY(0); }
  .pulse-account-link-actions button:disabled { opacity: .6; cursor: not-allowed; }
  .pulse-account-link-actions button[aria-busy="true"] { cursor: wait; }
  .pulse-account-link-actions :focus-visible { outline: 2px solid ${theme.accentSoft}; outline-offset: 3px; }
  .pulse-supporter-settings { max-width: 720px; }
  .pulse-supporter-settings .pulse-section-card { grid-template-columns: minmax(0, 1fr); }
  .pulse-supporter-settings p { margin: 0; line-height: 1.6; }
  .pulse-supporter-settings .pulse-settings-workspace-heading { margin-bottom: 20px; }
  .pulse-supporter-settings h2 { font-size: 20px; margin: 0 0 6px; }
  .pulse-supporter-detail { color: ${theme.textSecondary}; font-size: 12px; }
  .pulse-supporter-preview-intro {
    align-items: end;
    display: flex;
    gap: 12px;
    justify-content: space-between;
    min-width: 0;
  }
  .pulse-supporter-preview-intro > div { display: grid; gap: 3px; min-width: 0; }
  .pulse-supporter-preview-intro p { color: ${theme.textSecondary}; font-size: 12px; line-height: 1.45; margin: 0; }
  .pulse-supporter-preview-kicker {
    color: var(--pulse-accent-ink, #ddd6fe);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .pulse-supporter-preview-note {
    border: 1px solid ${theme.border};
    border-radius: 999px;
    color: ${theme.textMuted};
    flex: none;
    font-size: 12px;
    font-weight: 800;
    line-height: 1;
    padding: 5px 8px;
    text-transform: uppercase;
    white-space: nowrap;
  }
  /* Plain definition rows for the offer terms. Restrained on purpose: guide §14
     says the options page carries preferences, not a marketing hero. */
  .pulse-supporter-terms {
    display: grid;
    grid-template-columns: minmax(0, 7rem) minmax(0, 1fr);
    gap: 6px 12px;
    margin: 12px 0;
    font-size: 13px;
  }
  .pulse-supporter-terms dt { color: ${theme.textMuted}; font-weight: 700; }
  .pulse-supporter-terms dd { color: ${theme.textPrimary}; margin: 0; }
  @media (max-width: 560px) {
    .pulse-supporter-terms { grid-template-columns: minmax(0, 1fr); gap: 2px; }
    .pulse-supporter-terms dd { margin-bottom: 8px; }
  }
  /* Policy destinations sit below the offer as a quiet row, not three CTAs. */
  .pulse-supporter-policies {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid ${theme.border};
  }
  .pulse-supporter-policies a { color: ${theme.textSecondary}; font-weight: 600; }
  .pulse-supporter-policies a:hover { color: var(--pulse-accent-soft, #c4b5fd); }
  .pulse-supporter-chat-preview {
    display: grid; gap: 8px; min-height: 82px; padding: 14px; background: #18181b; border: 1px solid ${theme.border}; border-radius: 8px;
    transition: border-color 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
  }
  .pulse-supporter-chat-preview:focus-within { border-color: ${theme.accentSoft}; box-shadow: 0 0 0 3px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.12); }
  .pulse-supporter-chat-preview__message { align-items: center; display: flex; flex-wrap: wrap; gap: 7px; min-width: 0; }
  .pulse-supporter-chat-preview__badge { align-items: center; display: inline-flex; flex: 0 0 24px; height: 24px; justify-content: center; width: 24px; }
  .pulse-supporter-chat-preview__badge:empty { display: none; }
  .pulse-supporter-chat-preview strong { color: ${theme.accentSoft}; }
  .pulse-supporter-chat-preview__separator { color: ${theme.textMuted}; }
  .pulse-supporter-chat-preview__meta { color: ${theme.textMuted}; font-size: 12px; }
  .pulse-supporter-chat-preview svg, .pulse-supporter-badge-choices svg { flex-shrink: 0; }
  .pulse-supporter-chat-preview svg { animation: pulse-supporter-badge-in 260ms cubic-bezier(.2,.8,.2,1) both; }
  .pulse-supporter-badge-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 132px), 1fr)); gap: 8px; min-width: 0; padding: 0; margin: 0; border: 0; }
  .pulse-supporter-badge-choices legend { grid-column: 1 / -1; margin-bottom: 0; font-size: 12px; }
  .pulse-supporter-badge-choices label {
    display: flex; align-items: center; gap: 8px; cursor: pointer;
    border: 1px solid ${theme.border}; border-radius: 8px; min-height: 48px; min-width: 0; padding: 8px 10px;
    color: ${theme.textSecondary}; transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
  }
  .pulse-supporter-badge-choices label:hover { border-color: ${theme.accentSoft}; color: ${theme.textPrimary}; transform: translateY(-1px); }
  .pulse-supporter-badge-choices label:active { transform: translateY(0) scale(.985); }
  .pulse-supporter-badge-choices label:has(:checked) { border-color: ${theme.accentSoft}; background: ${theme.panelElevated}; color: ${theme.textPrimary}; box-shadow: inset 0 0 0 1px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.14); }
  .pulse-supporter-badge-choices label[data-selected="true"] { border-color: ${theme.accentSoft}; background: ${theme.panelElevated}; color: ${theme.textPrimary}; box-shadow: inset 0 0 0 1px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.14); }
  .pulse-supporter-badge-choices label:focus-within { outline: 2px solid ${theme.accentSoft}; outline-offset: 2px; }
  .pulse-supporter-badge-choices:disabled label { cursor: wait; transform: none; }
  .pulse-supporter-tenure-choices { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; margin-top: 16px; }
  .pulse-supporter-tenure-choices legend { color: ${theme.textSecondary}; font-weight: 800; margin-bottom: 8px; }
  .pulse-supporter-tenure-choices label {
    position: relative; flex-direction: column; justify-content: center; text-align: center; gap: 5px;
    min-height: 122px; padding: 9px 5px; font-size: 12px;
    background: linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,.01));
  }
  .pulse-supporter-tenure-choices label[data-stage-state="future"] { border-style: dashed; }
  .pulse-supporter-tenure-choices label[data-stage-state="reported-current"] { border-color: #9ae9d4; box-shadow: inset 0 0 0 1px rgba(154,233,212,.24); }
  .pulse-supporter-tenure-choices label[data-stage-state="reported-earlier"] { border-color: rgba(154,233,212,.42); }
  .pulse-supporter-tenure-choices label[data-pinnacle="true"] {
    border-color: rgba(255, 193, 158, .55);
    background: linear-gradient(150deg, rgba(255, 133, 190, .14), rgba(255, 225, 107, .07) 70%, rgba(255,255,255,.02));
  }
  .pulse-supporter-tenure-choices label[data-pinnacle="true"][data-selected="true"] { border-color: #ffd699; box-shadow: inset 0 0 0 1px rgba(255, 214, 153, .4); }
  .pulse-supporter-tenure-choices label strong { color: ${theme.textPrimary}; font-size: 12px; }
  .pulse-supporter-tenure-choices label small { color: ${theme.textMuted}; font-size: 12px; line-height: 1.2; }
  .pulse-supporter-tenure-choices label[data-stage-state="reported-current"] small { color: #9ae9d4; }
  .pulse-supporter-tenure-ordinal { color: ${theme.textMuted}; font-size: 12px; font-weight: 800; letter-spacing: .1em; }
  .pulse-supporter-tenure-choices input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .pulse-supporter-stage-detail {
    align-items: center; background: linear-gradient(110deg, rgba(25,28,32,.95), rgba(28,26,35,.9));
    border: 1px solid ${theme.border}; border-radius: 9px; display: flex; gap: 14px;
    margin-top: 12px; min-width: 0; padding: 13px 15px;
  }
  .pulse-supporter-stage-detail__mark { align-items: center; display: inline-flex; flex: 0 0 52px; justify-content: center; }
  .pulse-supporter-stage-detail > div { display: grid; gap: 2px; min-width: 0; }
  .pulse-supporter-stage-detail__eyebrow { color: ${theme.textMuted}; font-size: 12px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
  .pulse-supporter-stage-detail strong { color: ${theme.textPrimary}; font-size: 15px; }
  .pulse-supporter-stage-detail p { color: ${theme.textSecondary}; font-size: 12px; line-height: 1.4; }
  .pulse-supporter-chat-label { color: ${theme.textMuted}; font-size: 12px; font-weight: 800; letter-spacing: .07em; margin-top: 15px !important; text-transform: uppercase; }
  .pulse-supporter-badge-choices input, .pulse-supporter-preview-toggle input { accent-color: ${theme.accent}; }
  .pulse-supporter-finish-swatch { border: 1px solid rgba(255, 255, 255, 0.45); border-radius: 999px; box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.04); flex: none; height: 12px; width: 12px; }
  .pulse-supporter-finish-choice { display: grid; gap: 2px; min-width: 0; }
  .pulse-supporter-finish-choice strong { color: inherit; font-size: 12px; }
  .pulse-supporter-finish-choice small { color: ${theme.textMuted}; font-size: 12px; line-height: 1.35; }
  .pulse-supporter-finish-preview { border: 1px solid ${theme.border}; border-radius: 8px; overflow: hidden; }
  .pulse-supporter-finish-preview > div { transition: border-top-color 160ms ease; }
  .pulse-supporter-finish-preview path { transition: stroke 160ms ease; }
  .pulse-supporter-save-status { min-height: 20px; }
  .pulse-supporter-preview-toggle { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 12px; }
  .pulse-supporter-settings input:focus-visible { outline: 2px solid ${theme.accentSoft}; outline-offset: 3px; }
  @keyframes pulse-supporter-badge-in {
    from { opacity: 0; transform: translateY(3px) scale(.9); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (max-width: 480px) {
    .pulse-supporter-preview-intro { align-items: start; flex-direction: column; gap: 8px; }
    .pulse-supporter-preview-note { align-self: start; }
    .pulse-supporter-tenure-choices { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .pulse-supporter-tenure-choices label[data-pinnacle="true"] { grid-column: 1 / -1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse-account-link-actions button, .pulse-account-link-actions a, .pulse-supporter-chat-preview, .pulse-supporter-badge-choices label, .pulse-supporter-finish-preview > div, .pulse-supporter-finish-preview path { transition: none; transform: none !important; }
    .pulse-supporter-chat-preview svg { animation: none; }
  }
  :root {
    color-scheme: dark;
    /* Shared height for the extension-page brand row. */
    --pulse-host-bar-h: 56px;
  }
  * { box-sizing: border-box; }
  html, body {
    background: #0b0b0f;
    margin: 0;
    padding: 0;
    scrollbar-color: rgba(255, 255, 255, 0.22) #0b0b0f;
    scrollbar-width: thin;
  }
  html::-webkit-scrollbar { width: 10px; }
  html::-webkit-scrollbar-track { background: #0b0b0f; }
  html::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.18);
    border: 3px solid #0b0b0f;
    border-radius: 999px;
  }
  html::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.28); }
  body {
    color: ${theme.textPrimary};
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--pulse-accent-soft, #c4b5fd); }

  .pulse-host {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 100vh;
  }

  /* ---------- brand bar ---------- */
  .pulse-host-bar {
    align-items: center;
    backdrop-filter: blur(8px);
    background: rgba(13, 13, 18, 0.92);
    border-bottom: 1px solid ${theme.border};
    box-sizing: border-box;
    display: flex;
    gap: 12px;
    min-height: var(--pulse-host-bar-h);
    padding: 12px 20px;
  }
  .pulse-host-brand {
    align-items: center;
    display: flex;
    gap: 9px;
    min-width: 0;
  }
  .pulse-host-mark {
    border-radius: 8px;
    box-shadow: 0 0 0 1px ${theme.border};
    display: block;
    flex-shrink: 0;
    height: 28px;
    object-fit: contain;
    width: 28px;
  }
  /* Monogram fallback keeps the bar intact when the icon cannot be resolved. */
  .pulse-host-mark-fallback {
    align-items: center;
    background: linear-gradient(140deg, var(--pulse-accent, #8b5cf6), var(--pulse-accent-strong, #7c3aed));
    box-shadow: 0 2px 10px rgba(124, 58, 237, 0.35);
    color: #fff;
    display: inline-flex;
    font-size: 13px;
    font-weight: 900;
    justify-content: center;
  }
  .pulse-host-titles {
    display: grid;
    min-width: 0;
  }
  .pulse-host-titles h1 {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.2;
    margin: 0;
  }
  .pulse-host-titles span {
    color: ${theme.textMuted};
    /* Caps step, deliberately below the 13px title it sits under. */
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .pulse-host-bar-spacer { flex: 1 1 auto; }
  .pulse-host-version {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid ${theme.border};
    border-radius: 999px;
    color: ${theme.textSecondary};
    flex-shrink: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    font-weight: 700;
    padding: 4px 9px;
  }

  /* ---------- body: section links + content ---------- */
  .pulse-host-body {
    display: grid;
    align-items: start;
    gap: 24px;
    grid-template-columns: 184px minmax(0, 720px);
    margin: 0 auto;
    max-width: 1040px;
    padding: 24px 20px 56px;
    width: 100%;
  }
  .pulse-host-nav {
    display: grid;
    gap: 5px;
    position: sticky;
    top: 18px;
  }
  .pulse-host-nav-label {
    color: ${theme.textMuted};
    display: block;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 0 9px 5px;
    text-transform: uppercase;
  }
  .pulse-host-nav a {
    align-items: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 9px;
    color: ${theme.textSecondary};
    display: flex;
    gap: 8px;
    font-size: 12px;
    font-weight: 700;
    padding: 9px 10px;
    text-decoration: none;
    transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
  }
  .pulse-host-nav a:hover {
    background: rgba(255, 255, 255, 0.045);
    color: ${theme.textPrimary};
  }
  .pulse-host-nav a[aria-current="page"] {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.11);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.24);
    color: var(--pulse-accent-ink, #ddd6fe);
  }
  .pulse-host-nav-indicator {
    background: currentColor;
    border-radius: 999px;
    height: 5px;
    opacity: 0;
    width: 5px;
  }
  .pulse-host-nav a[aria-current="page"] .pulse-host-nav-indicator { opacity: 1; }
  .pulse-host-nav a:focus-visible {
    outline: 2px solid var(--pulse-accent-light, #a78bfa);
    outline-offset: 2px;
  }
  .pulse-host-main {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .pulse-host-footer {
    border-top: 1px solid ${theme.border};
    color: ${theme.textMuted};
    display: flex;
    flex-wrap: wrap;
    font-size: 13px;
    gap: 10px;
    margin-top: 6px;
    padding-top: 12px;
  }

  /* Narrow windows turn the rail into compact top navigation. */
  @media (max-width: 860px) {
    .pulse-host-body {
      gap: 14px;
      grid-template-columns: minmax(0, 1fr);
      padding: 14px 14px 40px;
    }
    .pulse-host-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      position: static;
    }
    .pulse-host-nav-label { display: none; }
    .pulse-host-nav a {
      flex: 1 1 auto;
      justify-content: center;
      padding: 8px 9px;
    }
    .pulse-host-nav-indicator { display: none; }
  }

  /* ---------- host-only settings controls ---------- */
  .pulse-settings-sections {
    display: grid;
    gap: 12px;
  }
  @keyframes pulse-settings-section-enter {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .pulse-settings-section-stage {
    animation: pulse-settings-section-enter 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
    min-width: 0;
  }
  .pulse-settings-sections:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.2);
    outline-offset: 4px;
  }
  .pulse-settings-flat-section {
    min-width: 0;
    scroll-margin-top: 16px;
  }
  .pulse-settings-page-section {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .pulse-settings-page-intro { display: grid; gap: 4px; margin-bottom: 2px; }
  .pulse-settings-page-intro > span {
    color: var(--pulse-accent-soft, #c4b5fd);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }
  .pulse-settings-page-intro h2 {
    color: ${theme.textPrimary};
    font-size: 22px;
    letter-spacing: -0.025em;
    line-height: 1.15;
    margin: 0;
  }
  .pulse-settings-page-intro p {
    color: ${theme.textMuted};
    font-size: 12px;
    line-height: 1.5;
    margin: 0;
    max-width: 62ch;
  }
  .pulse-settings-host-connection {
    align-items: center;
    display: flex;
    gap: 10px;
    min-width: 0;
  }
  .pulse-settings-host-connection > span:nth-child(2) { display: grid; flex: 1 1 auto; min-width: 0; }
  .pulse-settings-host-connection strong { color: ${theme.textPrimary}; font-size: 12px; }
  .pulse-settings-host-connection small { color: ${theme.textMuted}; font-size: 13px; }
  .pulse-settings-choice-grid {
    display: grid;
    gap: 7px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .pulse-settings-choice-grid[aria-label="Overlay placement"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .pulse-settings-choice-card {
    align-items: center;
    appearance: none;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid ${theme.border};
    border-radius: 9px;
    color: ${theme.textSecondary};
    cursor: pointer;
    display: flex;
    font-family: inherit;
    gap: 9px;
    min-width: 0;
    padding: 10px;
    text-align: left;
    transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease;
  }
  .pulse-settings-choice-card:hover { background: rgba(255, 255, 255, 0.045); transform: translateY(-1px); }
  .pulse-settings-choice-card-active {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.4);
    color: var(--pulse-accent-ink, #ddd6fe);
  }
  .pulse-settings-choice-card > span:last-child { display: grid; min-width: 0; }
  .pulse-settings-choice-card strong { color: inherit; font-size: 14px; }
  .pulse-settings-choice-card small { color: ${theme.textMuted}; font-size: 13px; }
  /* Styled here rather than inline so it uses the error token like every other
     failure surface. The class previously existed in no stylesheet at all. */
  .pulse-settings-error-banner {
    align-items: center;
    background: rgba(${theme.errorRgb}, 0.15);
    border: 1px solid rgba(${theme.errorRgb}, 0.4);
    border-radius: 8px;
    color: ${theme.error};
    display: flex;
    font-size: 12px;
    gap: 8px;
    justify-content: space-between;
    margin-bottom: 12px;
    padding: 8px 12px;
  }
  .pulse-settings-error-banner-dismiss {
    color: ${theme.error};
    cursor: pointer;
    flex-shrink: 0;
  }
  .pulse-settings-choice-swatch {
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.18);
    flex: 0 0 auto;
    height: 14px;
    width: 14px;
  }
  .pulse-settings-policy-link {
    color: var(--pulse-accent-soft, #c4b5fd);
    font-size: 14px;
    font-weight: 700;
    justify-self: start;
  }
  /* Policy destinations read as one row, not a stack of unrelated CTAs. */
  .pulse-settings-policy-links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 20px;
    justify-self: start;
  }
  .pulse-settings-version-card {
    align-items: center;
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.075);
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.22);
    border-radius: 11px;
    display: grid;
    gap: 12px;
    grid-template-columns: auto minmax(0, 1fr) auto;
    padding: 12px 13px;
  }
  .pulse-settings-version-card > span:first-child { display: grid; }
  .pulse-settings-version-card small { color: ${theme.textMuted}; font-size: 12px; font-weight: 700; text-transform: uppercase; }
  .pulse-settings-version-card strong { color: ${theme.textPrimary}; font-size: 16px; }
  .pulse-settings-update-copy { color: ${theme.textSecondary}; font-size: 13px; }
  .pulse-settings-update-row {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }
  .pulse-settings-update-row > span {
    color: ${theme.textMuted};
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .pulse-settings-update-row small {
    color: ${theme.textMuted};
    font-size: 12px;
    line-height: 1.35;
  }
  .pulse-settings-debug-log {
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid ${theme.border};
    border-radius: 8px;
    color: ${theme.textSecondary};
    font-size: 12px;
    line-height: 1.45;
    margin: 0;
    max-height: 220px;
    overflow: auto;
    padding: 9px;
    white-space: pre-wrap;
  }
  .pulse-settings-saved {
    color: ${theme.liveSoft};
    font-size: 13px;
    font-weight: 700;
  }
  .pulse-settings-subsection {
    display: grid;
    gap: 7px;
  }
  .pulse-settings-subsection + .pulse-settings-subsection {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding-top: 11px;
  }
  .pulse-settings-subhead,
  .pulse-settings-input-row,
  .pulse-settings-about-row,
  .pulse-settings-cache-meta {
    align-items: center;
    display: flex;
    gap: 7px;
    justify-content: space-between;
    min-width: 0;
  }
  .pulse-settings-input-row .pulse-settings-input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .pulse-settings-watchlist {
    display: grid;
    gap: 5px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .pulse-settings-watchlist li {
    align-items: center;
    background: rgba(255, 255, 255, 0.025);
    border-radius: 7px;
    display: flex;
    gap: 8px;
    justify-content: space-between;
    padding: 7px 8px;
  }
  .pulse-settings-watchlist li > span {
    display: grid;
    min-width: 0;
  }
  .pulse-settings-watchlist strong {
    color: ${theme.textPrimary};
    font-size: 14px;
  }
  .pulse-settings-watchlist small,
  .pulse-settings-about-row {
    color: ${theme.textMuted};
    font-size: 12px;
  }
  .pulse-settings-about-row a { color: var(--pulse-accent-soft, #c4b5fd); }
  .pulse-settings-nav h1 {
    color: ${theme.textPrimary};
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.01em;
    margin: 0;
  }
  .pulse-settings-skip-link {
    background: var(--pulse-accent, #8b5cf6);
    border-radius: 6px;
    color: var(--pulse-on-accent, #fff);
    font-size: 14px;
    font-weight: 800;
    left: 10px;
    padding: 7px 11px;
    position: absolute;
    top: -100px;
    transition: top 120ms ease;
    z-index: 40;
  }
  .pulse-settings-skip-link:focus { top: 10px; }
  .pulse-settings-field {
    display: grid;
    gap: 5px;
    min-width: 0;
  }
  .pulse-settings-field + .pulse-settings-field {
    margin-top: 9px;
  }
  .pulse-settings-input {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid ${theme.border};
    border-radius: 7px;
    color: ${theme.textPrimary};
    font-family: inherit;
    font-size: 14px;
    padding: 7px 8px;
  }
  .pulse-segment-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .pulse-segment-btn {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid ${theme.border};
    border-radius: 7px;
    color: ${theme.textSecondary};
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 10px;
  }
  .pulse-segment-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.075);
    color: ${theme.textPrimary};
  }
  .pulse-segment-btn-active {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.2);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45);
    color: var(--pulse-accent-ink, #ddd6fe);
  }
  .pulse-segment-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .pulse-settings-cache-meta {
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    color: ${theme.textMuted};
    font-size: 14px;
    line-height: 1.45;
    padding: 8px 10px;
  }

  /* ---------- changelog ---------- */
  .pulse-changelog {
    display: grid;
    gap: 9px;
  }
  .pulse-changelog-release {
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.075);
    border-radius: 10px;
    min-width: 0;
    overflow: hidden;
    transition: background 180ms ease, border-color 180ms ease;
  }
  .pulse-changelog-release[data-changelog-open="true"] {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.035);
    border-color: rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.24);
  }
  .pulse-changelog-heading,
  .pulse-changelog-toggle {
    align-items: center;
    display: grid;
    gap: 9px;
    grid-template-columns: auto minmax(0, 1fr) auto;
    padding: 11px 12px;
    width: 100%;
  }
  .pulse-changelog-heading-copy { display: grid; min-width: 0; }
  .pulse-changelog-heading-copy time { color: ${theme.textMuted}; font-size: 12px; margin-top: 2px; }
  .pulse-changelog-toggle {
    appearance: none;
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
  }
  .pulse-changelog-toggle:hover { background: rgba(255, 255, 255, 0.025); }
  .pulse-changelog-toggle:focus-visible {
    outline: 2px solid var(--pulse-accent-light, #a78bfa);
    outline-offset: -3px;
  }
  .pulse-changelog-badges {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .pulse-changelog-version,
  .pulse-changelog-lifecycle {
    border-radius: 999px;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.04em;
    line-height: 1;
    padding: 4px 8px;
    white-space: nowrap;
  }
  .pulse-changelog-version {
    background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.17);
    border: 1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.32);
    color: var(--pulse-accent-ink, #ddd6fe);
  }
  .pulse-changelog-lifecycle {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.28);
    color: rgba(187, 247, 208, 0.95);
    text-transform: uppercase;
  }
  .pulse-changelog-lifecycle[data-release-status="unreleased"] {
    background: rgba(251, 191, 36, 0.1);
    border-color: rgba(251, 191, 36, 0.28);
    color: #fde68a;
  }
  .pulse-changelog-title {
    color: ${theme.textPrimary};
    font-size: 13px;
    font-weight: 800;
    line-height: 1.3;
    min-width: 0;
  }
  .pulse-changelog-chevron {
    color: ${theme.textMuted};
    font-size: 20px;
    line-height: 1;
    transform: rotate(0deg);
    transition: color 160ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .pulse-changelog-release[data-changelog-open="true"] .pulse-changelog-chevron {
    color: var(--pulse-accent-soft, #c4b5fd);
    transform: rotate(90deg);
  }
  .pulse-changelog-reveal {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition: grid-template-rows 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease;
    visibility: hidden;
  }
  .pulse-changelog-release[data-changelog-open="true"] .pulse-changelog-reveal {
    grid-template-rows: 1fr;
    opacity: 1;
    visibility: visible;
  }
  .pulse-changelog-reveal-clip {
    min-height: 0;
    overflow: hidden;
  }
  .pulse-changelog-body {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: grid;
    gap: 11px;
    margin: 0 12px;
    padding: 11px 0 12px;
  }
  .pulse-changelog-summary-copy {
    color: ${theme.textSecondary};
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
    max-width: 72ch;
  }
  .pulse-changelog-list {
    color: ${theme.textSecondary};
    display: grid;
    font-size: 13px;
    gap: 5px;
    line-height: 1.45;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .pulse-changelog-list li {
    display: grid;
    gap: 7px;
    grid-template-columns: 5px minmax(0, 1fr);
  }
  .pulse-changelog-list li::before {
    background: var(--pulse-accent-soft, #c4b5fd);
    border-radius: 999px;
    content: '';
    height: 4px;
    margin-top: 5px;
    width: 4px;
  }
  .pulse-changelog-category { display: grid; gap: 6px; }
  .pulse-changelog-category h3 {
    color: var(--pulse-accent-soft, #c4b5fd);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.07em;
    margin: 0;
    text-transform: uppercase;
  }
  .pulse-changelog-category[data-release-category="knownIssues"] h3 { color: #fbbf24; }
  .pulse-changelog-links { display: flex; flex-wrap: wrap; gap: 12px; }
  .pulse-changelog-links a { color: var(--pulse-accent-soft, #c4b5fd); font-size: 13px; font-weight: 700; }

  @media (prefers-reduced-motion: reduce) {
    .pulse-host-nav a,
    .pulse-settings-skip-link,
    .pulse-changelog-release,
    .pulse-changelog-chevron,
    .pulse-changelog-reveal,
    .pulse-settings-choice-card { transition: none; }
    .pulse-settings-section-stage { animation: none; }
  }
  @media (max-width: 620px) {
    .pulse-changelog-heading,
    .pulse-changelog-toggle {
      align-items: start;
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .pulse-changelog-badges { grid-column: 1; }
    .pulse-changelog-heading-copy { grid-column: 1 / -1; grid-row: 2; }
    .pulse-changelog-chevron { grid-column: 2; grid-row: 1; }
    .pulse-settings-choice-grid { grid-template-columns: minmax(0, 1fr); }
    .pulse-settings-version-card { align-items: start; grid-template-columns: minmax(0, 1fr) auto; }
    .pulse-settings-update-copy { grid-column: 1 / -1; grid-row: 2; }
  }
`

let hostStylesInjected = false

/** Inject the settings-page stylesheet once per document. */
export function injectHostStyles(): void {
  if (hostStylesInjected || typeof document === 'undefined') return
  const id = 'streampulse-settings-host-styles'
  if (document.getElementById(id)) {
    hostStylesInjected = true
    return
  }
  const style = document.createElement('style')
  style.id = id
  style.textContent = hostStyles
  document.head.appendChild(style)
  hostStylesInjected = true
}
