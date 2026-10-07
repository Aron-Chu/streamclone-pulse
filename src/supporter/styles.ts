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

/** Your Line, plus the lab's sidebar-card glow and hover for the card that hosts it. */
export const CHAT_STACK_CSS = `${KIT_CSS}
.pulse-settings-supporter-cta::before { background: radial-gradient(70% 90% at 24% 100%, rgba(var(--spk-fin-rgb), 0.14), transparent 70%); content: ""; inset: 0; opacity: 0.5; pointer-events: none; position: absolute; transition: opacity 300ms; z-index: -1; }
.pulse-settings-panel .pulse-settings-supporter-cta:not(:disabled):is(:hover, :focus-visible) { border-color: rgba(var(--spk-fin-rgb), 0.45); filter: none; }
.pulse-settings-supporter-cta:is(:hover, :focus-visible)::before { opacity: 1; }
.spk-chat { font: 500 12px/18px ${FONT}; overflow: hidden; }
.spk-cl { color: #efeff1; display: block; height: 18px; left: 0; line-height: 18px; overflow: hidden; padding: 0 12px; position: absolute; right: 0; text-align: left; top: 0; transition: transform 260ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity 300ms; white-space: nowrap; }
.spk-cl b { font-weight: 700; }
.spk-cl .spk-em { display: inline-block; height: 18px; vertical-align: top; }
.spk-cl .spk-crest { display: inline-block; margin: 2px 4px 0 0; vertical-align: top; }
.spk-cl .pulse-paint { font-size: inherit; line-height: inherit; }
.spk-cl.spk-sup { background: rgba(var(--spk-fin-rgb), 0.1); box-shadow: inset 2px 0 0 var(--spk-fin); }
.spk-cl.spk-dim { opacity: 0.3 !important; }
.spk-cl.spk-sheen::after { animation: spk-sheen 900ms ease-out 1 forwards; background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.2) 50%, transparent 70%); background-size: 250% 100%; content: ""; inset: 0; pointer-events: none; position: absolute; }
@keyframes spk-sheen { from { background-position: 130% 0; } to { background-position: -60% 0; } }
.spk-chip { align-items: center; background: rgba(13, 13, 18, 0.92); border: 1px solid rgba(var(--spk-fin-rgb), 0.55); border-radius: 999px; color: var(--spk-fin-core); display: flex; font: 800 9.5px/14px ${FONT}; gap: 4px; height: 15px; padding: 0 6px; position: absolute; right: 8px; top: 1.5px; }
.spk-callouts { inset: 0; pointer-events: none; position: absolute; z-index: 3; }
.spk-co { background: var(--spk-fin-core); border-radius: 4px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6); color: #0b0b0f; font: 800 9.5px/1 ${FONT}; left: 0; letter-spacing: 0.01em; opacity: 0; padding: 3px 6px; position: absolute; top: 0; transition: opacity 180ms; white-space: nowrap; }
.spk-co::after { background: var(--spk-fin-core); content: ""; height: var(--lh, 6px); left: var(--lx, 50%); position: absolute; top: 100%; width: 1px; }
.spk-co.spk-below::after { bottom: 100%; top: auto; }
.spk-callouts.spk-on .spk-co { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .spk-cl, .spk-co, .pulse-settings-supporter-cta::before { transition: none; }
  .spk-paint, .spk-cl.spk-sheen::after { animation: none; }
}
`

/** The Emote Pile. */
export const EMOTE_PILE_CSS = `${KIT_CSS}
.spk-body { left: 0; position: absolute; top: 0; will-change: transform; }
.spk-body .spk-inner { align-items: center; display: flex; height: 100%; justify-content: center; width: 100%; }
.spk-you::before { background: radial-gradient(circle, rgba(var(--spk-fin-rgb), 0.55), transparent 68%); border-radius: 50%; content: ""; inset: -7px; position: absolute; z-index: -1; }
.spk-you .spk-crest { position: absolute; right: -7px; top: -7px; }
@media (prefers-reduced-motion: reduce) { .spk-paint { animation: none; } }
`
