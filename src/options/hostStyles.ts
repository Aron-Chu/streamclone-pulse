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
  /* The Supporter banner, "Crown, staged" (2026-10-07 round, direction B):
     the Emote Pile gets the whole right half, with a soft glow behind it that
     swells at each peak (data-glow="peak" on the stage); the copy, a bigger
     headline and three perk chips hold the left half. --spk-fin* is the shown
     kit's paint. The frame is the container its narrow layout answers to. */
  .pulse-settings-supporter-banner-frame { container: pulse-supporter-banner / inline-size; margin: 0 0 18px; min-width: 0; }
  .pulse-settings-supporter-banner {
    align-items: center;
    background: #15151c;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 12px;
    color: #fafafc;
    cursor: pointer;
    display: flex;
    font-family: inherit;
    gap: 14px;
    height: 132px;
    isolation: isolate;
    letter-spacing: 0;
    margin: 0;
    overflow: hidden;
    padding: 0 18px;
    position: relative;
    text-align: left;
    transition: border-color 300ms;
    width: 100%;
  }
  .pulse-settings-supporter-banner:hover, .pulse-settings-supporter-banner:focus-visible { border-color: rgba(var(--spk-fin-rgb), 0.5); }
  .pulse-settings-supporter-banner:focus-visible { outline: 2px solid var(--spk-fin); outline-offset: 3px; }
  .pulse-settings-supporter-banner::before { background: linear-gradient(90deg, #15151c 0%, #15151c 47%, rgba(21, 21, 28, 0) 53%); content: ""; inset: 0; pointer-events: none; position: absolute; z-index: -1; }
  /* The pile runs to the banner's edge, so it clips itself: a body or the peak glow at the edge never widens the banner. */
  .pulse-supporter-pile { bottom: 0; left: 50%; overflow: clip; pointer-events: none; position: absolute; right: 0; top: 0; z-index: -2; }
  .pulse-supporter-pile::before { background: radial-gradient(52% 78% at 56% 100%, rgba(var(--spk-fin-rgb), 0.17), transparent 72%); content: ""; inset: 0; opacity: 0.75; pointer-events: none; position: absolute; transform-origin: 56% 100%; transition: opacity 700ms ease, transform 700ms ease; z-index: -1; }
  .pulse-supporter-pile[data-glow="peak"]::before { opacity: 1; transform: scale(1.12); }
  .pulse-settings-supporter-banner-copy { display: grid; gap: 3px; max-width: min(372px, 50%); min-width: 0; position: relative; }
  .pulse-settings-supporter-banner-eyebrow { align-items: center; color: var(--spk-fin); column-gap: 6px; display: flex; flex-wrap: wrap; font-size: 12px; font-weight: 800; letter-spacing: 0.07em; line-height: 15px; row-gap: 1px; text-transform: uppercase; }
  .pulse-settings-supporter-banner-eyebrow > * { flex: none; }
  .pulse-settings-supporter-banner-eyebrow em { color: #8b8ba0; font-style: normal; white-space: nowrap; }
  .pulse-settings-supporter-banner-copy strong { font-size: 17px; font-weight: 800; letter-spacing: -0.01em; line-height: 22px; }
  .pulse-settings-supporter-banner-copy small { color: rgba(250, 250, 252, 0.72); font-size: 12px; line-height: 16px; text-wrap: pretty; }
  .pulse-settings-supporter-banner-perks { display: flex; flex-wrap: wrap; gap: 4px; margin: 3px 0 1px; }
  .pulse-settings-supporter-perk { align-items: center; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 999px; color: #e4e4ec; display: inline-flex; font-size: 12px; font-weight: 700; gap: 5px; height: 22px; line-height: 1; padding: 0 8px 0 4px; white-space: nowrap; }
  .pulse-settings-supporter-perk .pulse-crest { height: 15px; width: 15px; }
  .pulse-settings-supporter-perk img { height: 15px; width: auto; }
  .pulse-settings-supporter-swatch { border-radius: 50%; display: inline-block; flex: none; height: 13px; width: 13px; }
  .pulse-settings-supporter-banner-arrow { background: rgba(13, 13, 18, 0.8); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 999px; color: var(--spk-fin-core); font-size: 12px; font-weight: 700; padding: 6px 11px; position: absolute; right: 12px; top: 12px; transition: background 200ms, border-color 200ms; white-space: nowrap; z-index: 1; }
  .pulse-settings-supporter-banner[data-supporter-kit="sample"] .pulse-settings-supporter-banner-arrow { background: rgba(var(--spk-fin-rgb), 0.14); border-color: rgba(var(--spk-fin-rgb), 0.45); }
  .pulse-settings-supporter-banner:is(:hover, :focus-visible) .pulse-settings-supporter-banner-arrow { background: rgba(var(--spk-fin-rgb), 0.22); border-color: rgba(var(--spk-fin-rgb), 0.6); }
  .pulse-banner-customize [data-supporter-perk] a { color: var(--pulse-accent-ink, #ddd6fe); font-weight: 700; }
  @container pulse-supporter-banner (max-width: 560px) {
    .pulse-settings-supporter-banner { display: block; height: auto; padding: 14px 14px 92px; }
    .pulse-settings-supporter-banner::before { display: none; }
    .pulse-settings-supporter-banner-copy { max-width: none; }
    /* Here the pile spans the whole banner along its bottom; drops may fall in from above it, never sideways. */
    .pulse-supporter-pile { height: 84px; left: 0; overflow-y: visible; right: 0; top: auto; }
    .pulse-settings-supporter-banner-arrow { display: inline-block; margin-top: 10px; position: relative; right: auto; top: auto; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse-supporter-pile::before, .pulse-settings-supporter-banner-arrow { transition: none; }
  }
  .pulse-account-link-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .pulse-account-link-actions button, .pulse-account-link-actions a { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 8px 14px; border: 1px solid ${theme.border}; border-radius: 9px; background: ${theme.panel}; color: ${theme.textPrimary}; font: inherit; font-weight: 700; cursor: pointer; transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease, transform 140ms ease; }
  .pulse-account-link-actions button:hover:not(:disabled), .pulse-account-link-actions a:hover { border-color: ${theme.accentSoft}; background: ${theme.panelElevated}; color: ${theme.textPrimary}; transform: translateY(-1px); }
  .pulse-account-link-actions button:active:not(:disabled), .pulse-account-link-actions a:active { transform: translateY(0); }
  .pulse-account-link-actions button:disabled { opacity: .6; cursor: not-allowed; }
  .pulse-account-link-actions button[aria-busy="true"] { cursor: wait; }
  .pulse-account-link-actions :focus-visible { outline: 2px solid ${theme.accentSoft}; outline-offset: 3px; }
  /* Sign in with Twitch: Twitch brand purple with the white glitch mark. */
  .pulse-account-link-actions .pulse-twitch-signin { gap: 8px; border-color: #9146FF; background: #9146FF; color: #FFFFFF; }
  .pulse-account-link-actions .pulse-twitch-signin:hover:not(:disabled) { border-color: #772CE8; background: #772CE8; color: #FFFFFF; }
  .pulse-account-link-actions .pulse-twitch-signin:focus-visible { outline-color: #BF94FF; }
  .pulse-twitch-glitch { flex: none; }
  .pulse-account-link-actions .pulse-account-quiet-button { border-color: transparent; background: transparent; color: ${theme.textSecondary}; font-weight: 600; }
  .pulse-account-identity { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .pulse-account-identity > div { display: grid; gap: 2px; min-width: 0; }
  .pulse-account-avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; border: 1px solid ${theme.border}; object-fit: cover; }
  .pulse-account-name { font-weight: 700; overflow-wrap: anywhere; }
  .pulse-account-other-ways { display: grid; gap: 10px; border-top: 1px solid ${theme.border}; padding-top: 12px; }
  .pulse-account-other-ways > summary { width: fit-content; min-height: 32px; display: flex; align-items: center; gap: 6px; color: ${theme.textSecondary}; font-size: 13px; font-weight: 700; cursor: pointer; }
  .pulse-account-other-ways[open] > summary { color: ${theme.textPrimary}; }
  .pulse-account-other-ways > summary:focus-visible { outline: 2px solid ${theme.accentSoft}; outline-offset: 3px; border-radius: 4px; }
  .pulse-supporter-settings { max-width: 720px; }
  .pulse-supporter-settings .pulse-section-card { grid-template-columns: minmax(0, 1fr); }
  .pulse-supporter-settings p { margin: 0; line-height: 1.6; }
  /* One Supporter journey card: progress, status, facts, one primary action. */
  .pulse-journey { display: grid; gap: 12px; min-width: 0; min-height: 72px; }
  .pulse-journey-status { display: grid; gap: 6px; min-width: 0; }
  .pulse-journey-title { font-size: 15px; }
  .pulse-journey-notice { padding: 8px 10px; border: 1px solid ${theme.border}; border-radius: 8px; background: ${theme.bgCanvas}; color: ${theme.textSecondary}; font-size: 12px; }
  .pulse-journey-confirm { display: grid; gap: 10px; padding: 12px; border: 1px solid ${theme.border}; border-radius: 8px; background: ${theme.bgCanvas}; color: ${theme.textSecondary}; font-size: 12px; }
  .pulse-journey-confirm p { margin: 0; line-height: 1.5; }
  .pulse-journey-steps { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0; padding: 0; list-style: none; font-size: 12px; color: ${theme.textMuted}; }
  .pulse-journey-steps li { display: inline-flex; align-items: center; gap: 6px; min-height: 22px; }
  .pulse-journey-step-mark { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 1px solid ${theme.border}; border-radius: 999px; font-size: 12px; font-weight: 700; }
  .pulse-journey-steps li[data-step="current"] { color: ${theme.textPrimary}; font-weight: 600; }
  .pulse-journey-steps li[data-step="current"] .pulse-journey-step-mark { border-color: var(--pulse-accent-soft, #c4b5fd); color: var(--pulse-accent-soft, #c4b5fd); }
  .pulse-journey-steps li[data-step="done"] { color: ${theme.textSecondary}; }
  .pulse-journey-steps li[data-step="done"] .pulse-journey-step-mark { border-color: ${theme.live}; background: rgba(34, 197, 94, 0.14); color: ${theme.liveSoft}; }
  .pulse-journey-facts { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 0; font-size: 13px; }
  .pulse-journey-facts div { display: grid; gap: 1px; min-width: 0; }
  .pulse-journey-facts dt { color: ${theme.textMuted}; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .pulse-journey-facts dd { margin: 0; color: ${theme.textPrimary}; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .pulse-account-link-actions .pulse-journey-primary { border-color: var(--pulse-accent, #8b5cf6); background: var(--pulse-accent, #8b5cf6); color: var(--pulse-on-accent, #fff); text-decoration: none; }
  .pulse-account-link-actions .pulse-journey-primary:hover:not(:disabled) { border-color: var(--pulse-accent-strong, #7c3aed); background: var(--pulse-accent-strong, #7c3aed); color: var(--pulse-on-accent, #fff); }
  .pulse-account-link-actions .pulse-journey-secondary-link { text-decoration: none; }
  .pulse-account-link-code { font-variant-numeric: tabular-nums; font-weight: 700; letter-spacing: .08em; color: ${theme.textPrimary}; user-select: all; }
  .pulse-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .pulse-journey-restore { display: grid; gap: 8px; min-width: 0; }
  .pulse-journey-restore label { font-size: 12px; color: ${theme.textSecondary}; }
  .pulse-journey-restore input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; border: 1px solid ${theme.border}; border-radius: 8px; background: ${theme.panel}; color: ${theme.textPrimary}; padding: 10px 12px; font: inherit; }
  .pulse-journey-restore input:focus-visible { outline: 2px solid ${theme.accentSoft}; outline-offset: 2px; }
  .pulse-journey-devices { border-top: 1px solid ${theme.border}; padding-top: 8px; min-width: 0; }
  .pulse-journey-devices summary { box-sizing: border-box; min-height: 44px; padding: 10px 0; cursor: pointer; color: ${theme.textSecondary}; }
  .pulse-journey-devices summary:focus-visible { outline: 2px solid ${theme.accentSoft}; outline-offset: 2px; border-radius: 4px; }
  .pulse-journey-devices ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .pulse-journey-devices li { display: grid; gap: 6px; min-width: 0; padding: 10px; border: 1px solid ${theme.border}; border-radius: 8px; overflow-wrap: anywhere; }
  @media (max-width: 420px) {
    .pulse-journey-actions > * { flex: 1 1 100%; }
  }
  .pulse-supporter-settings .pulse-settings-workspace-heading { margin-bottom: 20px; }
  .pulse-supporter-settings h2 { font-size: 20px; margin: 0 0 6px; }
  .pulse-supporter-detail { color: ${theme.textSecondary}; font-size: 12px; }
  /* Plain definition rows for the offer terms. Restrained on purpose: guide §14
     says the options page carries preferences, not a marketing hero. */
  .pulse-supporter-settings .pulse-supporter-terms { color: ${theme.textSecondary}; font-size: 12.5px; }
  .pulse-supporter-terms b { color: ${theme.textPrimary}; }
  .pulse-supporter-terms > span::before { content: " · "; }
  /* Policy destinations sit below the offer as a quiet row, not three CTAs. */
  .pulse-supporter-policies {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid ${theme.border};
  }
  .pulse-supporter-policies a { display: inline-flex; align-items: center; box-sizing: border-box; min-width: 44px; min-height: 44px; padding: 0 4px; color: ${theme.textSecondary}; font-weight: 600; }
  .pulse-supporter-policies a:hover { color: var(--pulse-accent-soft, #c4b5fd); }
  .pulse-supporter-policies a:focus-visible { outline: 2px solid ${theme.accentSoft}; outline-offset: 3px; }
  .pulse-supporter-paint-sample { flex: none; font-size: 20px; font-weight: 900; line-height: 1; min-width: 28px; }
  .pulse-supporter-save-status { min-height: 20px; }
  .pulse-supporter-settings input:focus-visible { outline: 2px solid ${theme.accentSoft}; outline-offset: 3px; }

  /* ---------- Account & Supporter, direction B "Your card" (2026-10-07) ----------
     A Twitch-style viewer card: emote rain across its top (no gradient), the
     avatar overlapping it, the name and membership, a five-step crest ladder,
     and the membership journey as its footer. --spk-fin* is the card's paint. */
  .pulse-supporter-card {
    background: linear-gradient(180deg, #16161d 0%, #0d0d12 100%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px;
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.04);
    container: pulse-supporter-card / inline-size;
    display: grid;
    margin-bottom: 14px;
    min-width: 0;
    overflow: hidden;
    position: relative;
  }
  .pulse-supporter-card-banner { height: 92px; isolation: isolate; overflow: hidden; position: relative; }
  .pulse-supporter-card-banner .pulse-banner-art { z-index: 0; }
  .pulse-supporter-card-banner .pulse-banner-art img { height: 30px; width: 30px; }
  .pulse-supporter-card-sample { background: rgba(13, 13, 18, 0.92); border: 1px solid rgba(var(--spk-fin-rgb), 0.55); border-radius: 999px; color: var(--spk-fin-core); font-size: 12px; font-weight: 800; letter-spacing: 0.03em; line-height: 16px; padding: 2px 8px; pointer-events: none; position: absolute; right: 8px; top: 8px; z-index: 3; }
  .pulse-supporter-card-body { align-items: end; display: flex; flex-wrap: wrap; gap: 10px 14px; margin-top: -30px; padding: 0 16px; position: relative; z-index: 1; }
  .pulse-supporter-card-avatar { align-items: center; background: #1d1d26; border-radius: 999px; box-shadow: 0 0 0 4px #15151c, 0 0 0 6px var(--spk-fin); color: var(--spk-fin); display: inline-flex; flex: none; font-size: 26px; font-weight: 900; height: 64px; justify-content: center; overflow: hidden; width: 64px; }
  .pulse-supporter-card-avatar[data-identity="none"], .pulse-supporter-card-avatar[data-identity="unknown"] { box-shadow: 0 0 0 4px #15151c, 0 0 0 6px ${theme.border}; color: ${theme.textMuted}; }
  .pulse-supporter-card-avatar img { height: 100%; object-fit: cover; width: 100%; }
  .pulse-supporter-card-who { display: grid; flex: 1 1 200px; gap: 2px; min-width: 0; padding-bottom: 2px; }
  .pulse-supporter-card-who strong { align-items: center; color: ${theme.textPrimary}; display: flex; flex-wrap: wrap; font-size: 20px; font-weight: 900; gap: 7px; letter-spacing: -0.01em; line-height: 1.2; overflow-wrap: anywhere; }
  .pulse-supporter-card-who strong .pulse-crest { height: 24px; width: 24px; }
  .pulse-supporter-card-who > span { color: ${theme.textSecondary}; font-size: 12.5px; font-weight: 600; }
  .pulse-supporter-card-ladder { display: grid; gap: 8px; padding: 16px 16px 14px; }
  .pulse-supporter-ladder { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); list-style: none; margin: 0; padding: 0; position: relative; }
  .pulse-supporter-ladder::before, .pulse-supporter-ladder::after { border-radius: 999px; content: ""; height: 3px; left: 10%; position: absolute; top: 16px; }
  .pulse-supporter-ladder::before { background: #2a2a36; right: 10%; }
  .pulse-supporter-ladder::after { background: linear-gradient(90deg, var(--spk-fin), rgba(var(--spk-fin-rgb), 0.6)); width: calc(80% * var(--fill, 0)); }
  .pulse-supporter-ladder li { align-items: center; display: grid; gap: 4px; justify-items: center; position: relative; z-index: 1; }
  .pulse-supporter-ladder li > span { align-items: center; background: #15151c; border: 1px solid #2f2f3a; border-radius: 999px; display: flex; height: 35px; justify-content: center; width: 35px; }
  .pulse-supporter-ladder li .pulse-crest { height: 22px; width: 22px; }
  .pulse-supporter-ladder li small { color: ${theme.textMuted}; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .pulse-supporter-ladder li[data-step="off"] .pulse-crest { filter: grayscale(1); opacity: 0.32; }
  .pulse-supporter-ladder li[data-step="current"] > span { border-color: var(--spk-fin); box-shadow: 0 0 0 3px rgba(var(--spk-fin-rgb), 0.2), 0 0 18px rgba(var(--spk-fin-rgb), 0.35); }
  .pulse-supporter-ladder li[data-step="current"] small { color: var(--spk-fin-core); }
  .pulse-supporter-ladder li[data-step="start"] > span { border-color: #55556a; border-style: dashed; }
  .pulse-supporter-ladder li[data-step="start"] .pulse-crest { opacity: 0.7; }
  .pulse-supporter-settings .pulse-supporter-ladder-next { color: ${theme.textSecondary}; font-size: 12px; text-align: center; }
  .pulse-supporter-ladder-next b { color: ${theme.textPrimary}; }
  /* The card's footer is the membership journey: its status, then one action. */
  .pulse-supporter-card > .pulse-journey { border-top: 1px solid rgba(255, 255, 255, 0.07); gap: 10px; min-height: 0; padding: 12px 16px; }
  .pulse-supporter-card > .pulse-journey[data-tone="warn"] { background: rgba(253, 186, 116, 0.07); border-top-color: rgba(253, 186, 116, 0.3); }
  .pulse-supporter-card > .pulse-journey[data-tone="warn"] .pulse-journey-status { color: #fed7aa; }
  .pulse-journey-row { align-items: center; display: flex; flex-wrap: wrap; gap: 10px 14px; justify-content: space-between; min-width: 0; }
  .pulse-journey-main { display: grid; flex: 1 1 260px; gap: 6px; min-width: 0; }
  .pulse-journey-row > .pulse-journey-actions { flex: none; }
  .pulse-supporter-card > .pulse-journey .pulse-journey-status p:not(.pulse-journey-title) { color: ${theme.textSecondary}; font-size: 12.5px; }
  /* Facts read as one line here: "Access through Oct 27, 2026". */
  .pulse-supporter-card > .pulse-journey .pulse-journey-facts { font-size: 12.5px; }
  .pulse-supporter-card > .pulse-journey .pulse-journey-facts div { display: flex; flex-wrap: wrap; gap: 0 5px; }
  .pulse-supporter-card > .pulse-journey .pulse-journey-facts dt { color: ${theme.textSecondary}; font-size: 12.5px; font-weight: 600; letter-spacing: 0; text-transform: none; }
  .pulse-supporter-card > .pulse-journey .pulse-journey-facts dd { font-weight: 700; }
  .pulse-supporter-ext { font-size: 0.9em; margin-left: 5px; opacity: 0.8; }

  /* "Who sees what": three rows, the concept one dashed in amber. */
  .pulse-supporter-who { display: grid; gap: 8px; list-style: none; margin: 0; padding: 0; }
  .pulse-supporter-who > li { align-items: center; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 10px; display: grid; gap: 8px 14px; grid-template-columns: minmax(0, 170px) minmax(0, 1fr); padding: 10px 12px; }
  .pulse-supporter-who > li[data-concept="true"] { background: repeating-linear-gradient(135deg, rgba(253, 186, 116, 0.035) 0 8px, transparent 8px 16px); border: 1px dashed rgba(253, 186, 116, 0.38); }
  .pulse-supporter-who-label { display: grid; gap: 5px; justify-items: start; min-width: 0; }
  .pulse-supporter-who-label strong { color: ${theme.textPrimary}; font-size: 13px; font-weight: 800; }
  .pulse-supporter-who-label small { color: ${theme.textMuted}; font-size: 12px; line-height: 1.35; }
  .pulse-supporter-vis { align-items: center; border: 1px solid ${theme.border}; border-radius: 999px; color: ${theme.textSecondary}; display: inline-flex; font-size: 12px; font-weight: 800; gap: 5px; letter-spacing: 0.02em; line-height: 1; padding: 4px 8px; white-space: nowrap; }
  .pulse-supporter-vis svg { flex: none; }
  .pulse-supporter-vis[data-concept="true"] { background: rgba(253, 186, 116, 0.08); border-color: rgba(253, 186, 116, 0.45); border-style: dashed; color: #fed7aa; }
  .pulse-supporter-who-preview { display: grid; gap: 6px; min-width: 0; }
  .pulse-supporter-mini-head { background: ${theme.bgCanvas}; border: 1px solid #2a2a36; border-radius: 8px; isolation: isolate; overflow: hidden; padding: 7px 10px; position: relative; }
  .pulse-supporter-mini-head .pulse-banner-art { z-index: 0; }
  .pulse-supporter-mini-head .pulse-banner-art img { height: 24px; width: 24px; }
  .pulse-supporter-mini-head > div:not(.pulse-banner-art) { position: relative; z-index: 1; }
  .pulse-supporter-mini-head h2 { font-size: 15px !important; }
  .pulse-supporter-mini-head h2 + span { align-self: center; }
  /* The real title block, without its lead line: one row, like the panel's top. */
  .pulse-supporter-mini-head > p { display: none; }
  .pulse-supporter-settings .pulse-supporter-chat-line { background: #18181b; border: 1px solid #2f2f35; border-radius: 8px; color: #efeff1; font: 13px/20px Inter, ui-sans-serif, system-ui, sans-serif; overflow-wrap: anywhere; padding: 6px 10px; }
  .pulse-supporter-chat-line b { font-weight: 700; }
  .pulse-supporter-chat-line .pulse-crest, .pulse-supporter-chat-line svg { display: inline-block; height: 18px; margin: 0 3px -4px 0; width: 18px; }
  @container pulse-supporter-card (max-width: 520px) {
    .pulse-supporter-card-body { padding: 0 14px; }
  }
  @media (max-width: 620px) {
    .pulse-supporter-who > li { grid-template-columns: minmax(0, 1fr); }
  }

  /* "Your look": paint, wave, sheen and emote rain as rows of tiles. */
  .pulse-supporter-look { display: grid; gap: 12px; }
  .pulse-supporter-look-row { align-items: start; border: 0; display: grid; gap: 6px 14px; grid-template-columns: minmax(0, 120px) minmax(0, 1fr); margin: 0; min-width: 0; padding: 0; }
  .pulse-supporter-look-row > legend { color: ${theme.textSecondary}; float: left; font-size: 12px; font-weight: 700; padding: 8px 0 0; }
  .pulse-supporter-tiles { display: grid; gap: 6px; grid-template-columns: repeat(4, minmax(0, 1fr)); max-width: 420px; }
  .pulse-supporter-tile { align-items: center; background: rgba(255, 255, 255, 0.024); border: 1px solid ${theme.border}; border-radius: 9px; color: ${theme.textSecondary}; cursor: pointer; display: grid; gap: 1px; justify-items: center; min-height: 54px; min-width: 0; padding: 6px 4px; position: relative; transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease; }
  .pulse-supporter-tile:hover { border-color: ${theme.accentSoft}; color: ${theme.textPrimary}; }
  .pulse-supporter-tile:has(:checked) { background: ${theme.panelElevated}; border-color: ${theme.accentSoft}; box-shadow: inset 0 0 0 1px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.14); color: ${theme.textPrimary}; }
  .pulse-supporter-tile:focus-within { outline: 2px solid ${theme.accentSoft}; outline-offset: 2px; }
  .pulse-supporter-tile input { height: 1px; opacity: 0; position: absolute; width: 1px; }
  .pulse-supporter-tile .pulse-supporter-paint-sample { font-size: 18px; line-height: 1.1; min-width: 0; }
  .pulse-supporter-tile small { font-size: 12px; font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pulse-supporter-look-row:disabled .pulse-supporter-tile { cursor: wait; }
  .pulse-supporter-seg { background: ${theme.bgCanvas}; border: 1px solid ${theme.border}; border-radius: 10px; display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; }
  .pulse-supporter-seg button { background: transparent; border: 0; border-radius: 7px; color: ${theme.textSecondary}; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; min-height: 30px; padding: 5px 11px; }
  .pulse-supporter-seg button[aria-pressed="true"] { background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.2); box-shadow: inset 0 0 0 1px rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45); color: ${theme.accentInk}; }
  .pulse-supporter-seg button:focus-visible { outline: 2px solid ${theme.accentSoft}; outline-offset: 1px; }
  .pulse-supporter-seg button:disabled { cursor: not-allowed; opacity: 0.6; }
  .pulse-supporter-look-row [data-supporter-perk] { margin-top: 6px; }
  @media (max-width: 620px) {
    .pulse-supporter-look-row { grid-template-columns: minmax(0, 1fr); }
    .pulse-supporter-look-row > legend { float: none; padding: 0; }
  }

  /* The Account card: plain label / value / action rows. */
  .pulse-supporter-rows { display: grid; gap: 0; margin: 0; }
  .pulse-supporter-rows > div { align-items: center; border-top: 1px solid rgba(255, 255, 255, 0.06); display: grid; gap: 4px 14px; grid-template-columns: minmax(0, 120px) minmax(0, 1fr) auto; padding: 10px 0; }
  .pulse-supporter-rows > div:first-child { border-top: 0; padding-top: 2px; }
  .pulse-supporter-rows dt { color: ${theme.textMuted}; font-size: 12px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; }
  .pulse-supporter-rows dd { color: ${theme.textPrimary}; font-size: 13px; margin: 0; min-width: 0; }
  .pulse-supporter-rows dd small { color: ${theme.textSecondary}; display: block; font-size: 12px; }
  .pulse-supporter-rows .pulse-account-link-actions { gap: 6px; }
  .pulse-supporter-rows .pulse-account-link-actions button { min-height: 44px; padding: 6px 12px; }
  /* The outcome of an Account action, under its rows; empty, it takes no room. */
  .pulse-supporter-account-status:not(:empty) { margin-top: 10px; }
  @media (max-width: 620px) {
    .pulse-supporter-rows > div { grid-template-columns: minmax(0, 1fr); }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse-account-link-actions button, .pulse-account-link-actions a, .pulse-supporter-tile { transition: none; transform: none !important; }
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
