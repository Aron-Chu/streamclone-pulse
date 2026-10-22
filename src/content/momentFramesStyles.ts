/** The moment-pictures script's styles; the site's /extension demo draws its sample pictures with them too. */

// A card's picture top is 9/16 of the card's width less its 2 px border, and
// the card's text overlaps 38 px of it (56 px under a game line). Top Moments'
// reserve (data-moment-reserve) grows by the rest, as padding outside its
// min-height that follows the card's width, so its cards still all open to
// one height.
export const MOMENT_FRAMES_CSS = `
.pmf-thumb{display:none;position:relative;flex:none;align-self:center;width:48px;height:27px;border-radius:4px;overflow:hidden;background:repeating-linear-gradient(135deg,rgba(255,255,255,.07) 0 3px,rgba(255,255,255,.02) 3px 7px)}
[data-pmf-pictures] .pmf-thumb{display:block!important}
.pmf-thumb[data-has]{background:#000}
.pmf-thumb img,.pmf-pic img{display:block;width:100%;height:100%;object-fit:cover}
.pmf-stage:not(:empty){margin:0 0 9px}
.pmf-pic{position:relative;aspect-ratio:16/9;border-radius:6px;overflow:hidden;background:#000;cursor:ew-resize;outline:none;touch-action:pan-y;user-select:none}
.pmf-pic:focus-visible{box-shadow:0 0 0 2px rgba(var(--pulse-accent-light-rgb,167,139,250),.85)}
.pmf-chip{position:absolute;left:6px;top:6px;display:flex;align-items:center;gap:5px;padding:3px 7px;border-radius:999px;background:rgba(0,0,0,.62);color:#fff;font-size:9.5px;font-weight:700;line-height:1}
.pmf-chip::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--pmf-dot,#34d399)}
.pmf-time{position:absolute;left:7px;bottom:6px;color:#fff;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px #000}
.pmf-peak{position:absolute;right:6px;bottom:6px;padding:2px 6px;border-radius:4px;background:#f43f5e;color:#fff;font-size:9px;font-weight:900;letter-spacing:.04em}
.pmf-peak[hidden]{display:none}
.pmf-rail{display:flex;gap:2px;margin:4px 0 0}
.pmf-rail i{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.14)}
.pmf-rail i[data-peak]{background:rgba(244,63,94,.6)}
.pmf-rail i[data-on]{background:rgba(var(--pulse-accent-light-rgb,167,139,250),.95)}
.pmf-tile{position:absolute;inset:0;overflow:hidden}
.pmf-art{position:absolute;inset:-20px;background:center/cover;filter:blur(14px) saturate(1.2) brightness(.55)}
.pmf-box{position:absolute;top:14px;left:50%;width:60px;aspect-ratio:3/4;transform:translateX(-50%);border-radius:5px;background:center/cover;box-shadow:0 8px 20px rgba(0,0,0,.6)}
.pmf-glow{position:absolute;inset:0;background:radial-gradient(60% 70% at 50% 40%,rgba(139,92,246,.35),transparent 72%),#15121f}
.pmf-pic .pmf-big{position:absolute;top:18%;left:50%;width:64px;height:64px;transform:translateX(-50%);object-fit:contain;filter:drop-shadow(0 6px 16px rgba(0,0,0,.6))}
.pmf-stage[data-top]{position:relative;margin:-10px -12px -28px;border-radius:7px 7px 0 0;overflow:hidden}
.pulse-sel>div:has(>.pulse-sel-game)>.pmf-stage[data-top]{margin-bottom:-46px}
.pmf-stage[data-top] .pmf-pic{border-radius:0;-webkit-mask-image:linear-gradient(#000 40%,transparent);mask-image:linear-gradient(#000 40%,transparent)}
.pmf-stage[data-top]>.pmf-rail{position:absolute;top:4px;left:8px;right:38px;margin:0}
.pmf-stage[data-top] .pmf-chip{top:10px;left:8px}
.pmf-stage[data-top] :is(.pmf-time,.pmf-peak){top:10px;bottom:auto;left:auto;right:38px}
.pmf-stage[data-top] .pmf-time:has(~.pmf-peak:not([hidden])){display:none}
.pulse-sel>div:has(>.pmf-stage[data-top]){position:relative;display:flex;flex-direction:column}
.pulse-sel>div:has(>.pmf-stage[data-top])>*{order:2}
.pulse-sel>div:has(>.pmf-stage[data-top])>:is(.pmf-stage,.pulse-sel-header){order:0}
.pulse-sel>div:has(>.pmf-stage[data-top])>.pulse-sel-game{order:1;z-index:1;margin-top:1px;color:#d4d4de;text-shadow:0 1px 2px #000}
.pmf-stage[data-top]~.pulse-sel-header{z-index:1}
.pmf-stage[data-top]~.pulse-sel-header .pulse-sel-kicker{color:#c9c9d6;text-shadow:0 1px 2px #000}
.pmf-stage[data-top]~.pulse-sel-header .pulse-sel-offset{font-size:17px;text-shadow:0 1px 3px #000}
.pmf-stage[data-top]~.pulse-sel-header .pulse-sel-close{position:absolute;top:-3px;right:-4px;display:grid;place-items:center;width:22px;height:22px;margin:0;padding:0;border-radius:50%;background:rgba(0,0,0,.55);color:#fff}
[data-moment-reserve]:has(>.pulse-sel>div>.pmf-stage[data-top]){box-sizing:content-box;padding-top:calc(56.25% - 39px)}
[data-moment-reserve]>.pulse-sel:has(>div>.pmf-stage[data-top]){margin-top:calc(39px - 56.25%)}
[data-moment-reserve=games]:has(>.pulse-sel>div>.pmf-stage[data-top]){padding-top:calc(56.25% - 57px)}
[data-moment-reserve=games]>.pulse-sel:has(>div>.pmf-stage[data-top]){margin-top:calc(57px - 56.25%)}
`
