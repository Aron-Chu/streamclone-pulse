/**
 * The lab's stage styles, prefixed `spk-` so they cannot collide with the
 * overlay's or the settings page's own classes. Each stage carries its own
 * `<style>`, so the rules reach the Twitch panel's shadow root and the settings
 * page alike and leave with the stage. Colours come from `--spk-fin*`, the kit's
 * paint (the lab's `--fin*`).
 */
const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

const KIT_CSS = `
.spk-crest { display: inline-flex; flex: none; }
.spk-crest svg { display: block; }
.spk-em { display: block; height: 100%; max-width: none; pointer-events: none; user-select: none; width: auto; }
.spk-paint { -webkit-background-clip: text; background-clip: text; background-image: var(--spk-paint); background-size: 260% 100%; animation: spk-paint-sweep 3.4s linear infinite; color: transparent; -webkit-text-fill-color: transparent; }
@keyframes spk-paint-sweep { from { background-position: 100% 0; } to { background-position: -160% 0; } }
`

/** The Emote Pile: your crest glows in your paint, and a "you" tag rides above the newest one. */
export const EMOTE_PILE_CSS = `${KIT_CSS}
.spk-body { left: 0; position: absolute; top: 0; will-change: transform; }
.spk-body .spk-inner { align-items: center; display: flex; height: 100%; justify-content: center; width: 100%; }
.spk-you::before { background: radial-gradient(circle, rgba(var(--spk-fin-rgb), 0.55), transparent 68%); border-radius: 50%; content: ""; inset: -7px; position: absolute; z-index: -1; }
.spk-tag { align-items: center; background: rgba(13, 13, 18, 0.92); border: 1px solid rgba(var(--spk-fin-rgb), 0.55); border-radius: 999px; box-sizing: border-box; color: var(--spk-fin-core); display: inline-flex; font: 800 9.5px/14px ${FONT}; height: 16px; left: 0; opacity: 0; padding: 0 6px; pointer-events: none; position: absolute; top: 0; transition: opacity 200ms; white-space: nowrap; will-change: transform; z-index: 3; }
.spk-tag .spk-name { font-weight: 800; }
.spk-tag .pulse-paint { font-size: inherit; line-height: inherit; }
@media (prefers-reduced-motion: reduce) { .spk-paint { animation: none; } .spk-tag { transition: none; } }
`

/**
 * The quick-settings Supporter card: the same Crown pile as the settings
 * banner, plus the lab's sidebar-card glow and hover for the card that hosts
 * it. It shows the crest, paint and emotes on their own, never as a line in a
 * chat column: nothing a Supporter has is added to Twitch chat.
 */
export const CARD_PILE_CSS = `${EMOTE_PILE_CSS}
.pulse-settings-supporter-cta::before { background: radial-gradient(70% 90% at 24% 100%, rgba(var(--spk-fin-rgb), 0.14), transparent 70%); content: ""; inset: 0; opacity: 0.5; pointer-events: none; position: absolute; transition: opacity 300ms; z-index: -1; }
.pulse-settings-panel .pulse-settings-supporter-cta:not(:disabled):is(:hover, :focus-visible) { border-color: rgba(var(--spk-fin-rgb), 0.45); filter: none; }
.pulse-settings-supporter-cta:is(:hover, :focus-visible)::before { opacity: 1; }
.pulse-supporter-stage { overflow: hidden; }
@media (prefers-reduced-motion: reduce) { .pulse-settings-supporter-cta::before { transition: none; } }
`
