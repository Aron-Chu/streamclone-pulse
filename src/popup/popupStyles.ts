/**
 * Toolbar popup stylesheet. The popup is its own page, so it carries its own
 * small sheet instead of the overlay's shadow styles. Accent colours come from
 * the `--pulse-*` properties applyAccentTheme writes on <html>; the popup
 * follows the browser's light or dark scheme like other browser UI.
 */
export const popupStyles = `
:root {
  color-scheme: dark;
  --pp-page: #111117;
  --pp-card: #18181d;
  --pp-well: #212128;
  --pp-line: rgba(255, 255, 255, 0.08);
  --pp-line-strong: rgba(255, 255, 255, 0.16);
  --pp-hover: rgba(255, 255, 255, 0.05);
  --pp-text: #f4f4f6;
  --pp-text-2: #b4b4c0;
  --pp-text-3: #8f8f9d;
  --pp-ink: var(--pulse-accent-soft, #c4b5fd);
  --pp-chart: var(--pulse-accent, #8b5cf6);
  --pp-chart-fill: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.3);
  --pp-tint: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.16);
  --pp-live: #eb0400;
  --pp-ok: #22c55e;
  --pp-bad: #f87171;
  --pp-shadow: 0 1px 0 rgba(255, 255, 255, 0.03) inset;
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --pp-page: #f1f1f4;
    --pp-card: #ffffff;
    --pp-well: #f3f3f6;
    --pp-line: rgba(14, 14, 16, 0.1);
    --pp-line-strong: rgba(14, 14, 16, 0.2);
    --pp-hover: rgba(14, 14, 16, 0.05);
    --pp-text: #0e0e10;
    --pp-text-2: #464651;
    --pp-text-3: #5f5f6b;
    --pp-ink: color-mix(in oklab, var(--pulse-accent-strong, #7c3aed) 62%, #000);
    --pp-chart: color-mix(in oklab, var(--pulse-accent-strong, #7c3aed) 80%, #000);
    --pp-chart-fill: rgba(var(--pulse-accent-strong-rgb, 124, 58, 237), 0.22);
    --pp-tint: rgba(var(--pulse-accent-strong-rgb, 124, 58, 237), 0.12);
    --pp-ok: #15803d;
    --pp-bad: #b91c1c;
    --pp-shadow: 0 1px 2px rgba(14, 14, 16, 0.06);
  }
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; background: var(--pp-page); }
body {
  width: 320px;
  color: var(--pp-text);
  font: 400 13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--pp-ink); outline-offset: 2px; }
.pp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.pp { display: grid; gap: 8px; padding: 8px 12px 6px; }

.pp-top { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.pp-mark { width: 22px; height: 22px; border-radius: 6px; display: block; }
.pp-word { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.pp-icon {
  margin-left: auto;
  width: 32px; height: 32px;
  display: grid; place-items: center;
  border: 0; border-radius: 8px;
  background: transparent; color: var(--pp-text-2);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.pp-icon:hover { background: var(--pp-hover); color: var(--pp-text); }
.pp-icon svg { width: 18px; height: 18px; }

.pp-card {
  background: var(--pp-card);
  border: 1px solid var(--pp-line);
  border-radius: 12px;
  box-shadow: var(--pp-shadow);
  padding: 10px 12px;
  animation: pp-rise 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.pp-chan { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.pp-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  display: grid; place-items: center;
  object-fit: cover;
  background: var(--pp-well);
  color: var(--pp-text-2);
  font-size: 17px; font-weight: 800;
}
.pp-avatar[data-live] { box-shadow: 0 0 0 2px var(--pp-card), 0 0 0 4px var(--pp-live); }
.pp-eyebrow { margin: 0; font-size: 11px; font-weight: 600; color: var(--pp-text-3); }
.pp-name { margin: 0; font-size: 17px; font-weight: 750; letter-spacing: -0.015em; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-meta { margin: 1px 0 0; font-size: 12px; color: var(--pp-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-badge {
  align-self: start;
  padding: 4px 6px; border-radius: 4px;
  background: var(--pp-live); color: #fff;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.04em; line-height: 1;
  text-transform: uppercase;
}
.pp-badge[data-tone="offline"] { background: var(--pp-well); color: var(--pp-text-2); box-shadow: 0 0 0 1px var(--pp-line) inset; }

.pp-activity { margin-top: 10px; }
.pp-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.pp-label { margin: 0; font-size: 11px; font-weight: 600; color: var(--pp-text-3); }
.pp-rate { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.pp-rate small { font-size: 11px; font-weight: 600; color: var(--pp-text-3); }
.pp-spark { display: block; width: 100%; height: 44px; margin-top: 6px; overflow: visible; }
.pp-spark-area { fill: url(#pp-spark-fill); animation: pp-fade 500ms 200ms ease both; }
.pp-spark-fill-top { stop-color: var(--pp-chart-fill); }
.pp-spark-fill-bottom { stop-color: var(--pp-chart-fill); stop-opacity: 0; }
.pp-spark-line {
  fill: none; stroke: var(--pp-chart); stroke-width: 1.75;
  stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 1; stroke-dashoffset: 0;
  animation: pp-draw 700ms cubic-bezier(0.45, 0, 0.2, 1) both;
}
.pp-spark-dot { fill: var(--pp-chart); }
.pp-spark-halo { fill: var(--pp-chart); transform-box: fill-box; transform-origin: center; animation: pp-halo 2.4s ease-out 700ms infinite; opacity: 0; }
.pp-axis { display: flex; justify-content: space-between; margin-top: 3px; font-size: 10.5px; color: var(--pp-text-3); }

.pp-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0 0; }
.pp-stat { min-width: 0; padding: 6px 10px; border-radius: 8px; background: var(--pp-well); }
.pp-stat dt { font-size: 11px; font-weight: 600; color: var(--pp-text-3); }
.pp-stat dd { margin: 2px 0 0; display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pp-stat dd span { overflow: hidden; text-overflow: ellipsis; }
.pp-stat dd small { font-size: 11px; font-weight: 600; color: var(--pp-text-3); }
.pp-emote { width: 22px; height: 22px; flex: none; object-fit: contain; }

.pp-moment {
  display: flex; align-items: center; gap: 8px;
  margin-top: 8px; padding-top: 8px;
  border-top: 1px solid var(--pp-line);
  font-size: 12px; color: var(--pp-text-2);
  min-width: 0;
}
.pp-moment svg { width: 16px; height: 16px; flex: none; color: var(--pp-ink); }
.pp-moment span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-moment b { color: var(--pp-text); font-weight: 650; }
.pp-moment time { margin-left: auto; flex: none; color: var(--pp-text-3); font-variant-numeric: tabular-nums; }

.pp-note { margin: 12px 0 0; font-size: 12px; color: var(--pp-text-2); }
.pp-note strong { display: block; color: var(--pp-text); font-size: 13px; font-weight: 650; }
.pp-inline {
  border: 0; padding: 0; background: none;
  color: var(--pp-ink); font-weight: 650; text-decoration: underline; text-underline-offset: 2px;
  cursor: pointer;
}

.pp-primary {
  width: 100%; min-height: 36px; margin-top: 10px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  border: 0; border-radius: 8px;
  background: var(--pulse-accent-strong, #7c3aed); color: var(--pulse-on-accent, #fff);
  font-size: 13px; font-weight: 700;
  cursor: pointer;
  transition: filter 120ms ease, transform 120ms ease;
}
.pp-primary:hover { filter: brightness(1.08); }
.pp-primary:active { transform: translateY(1px); }
.pp-primary svg { width: 16px; height: 16px; }

.pp-hero { display: grid; justify-items: start; gap: 4px; }
.pp-hero h1 { margin: 0; font-size: 16px; font-weight: 750; letter-spacing: -0.015em; }
.pp-hero p { margin: 0; font-size: 12px; color: var(--pp-text-2); }

.pp-live { overflow: hidden; }
.pp-live-title { margin: 0; font-size: 15px; font-weight: 750; letter-spacing: -0.01em; }
.pp-live-count { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: var(--pp-text-2); font-variant-numeric: tabular-nums; }
.pp-live-count::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--pp-live); animation: pp-beat 2s ease-out infinite; }
.pp-live-stats { margin: 3px 0 0; font-size: 12px; color: var(--pp-text-2); font-variant-numeric: tabular-nums; }
.pp-live-stats b { color: var(--pp-text); font-weight: 700; }

.pp-ticker {
  position: relative; overflow: hidden;
  margin: -10px -12px 8px; padding: 6px 0;
  border-bottom: 1px solid var(--pp-line);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
}
.pp-ticker-track { display: inline-flex; gap: 18px; padding-left: 12px; white-space: nowrap; animation: pp-slide 40s linear infinite; }
.pp-ticker:hover .pp-ticker-track { animation-play-state: paused; }
.pp-tick { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; }
.pp-tick small { font-size: 11px; font-weight: 600; color: var(--pp-text-3); }
.pp-tick-emote { width: 20px; height: 20px; object-fit: contain; display: block; }

.pp-chan-list, .pp-jump-list { list-style: none; margin: 6px -8px 0; padding: 0; display: grid; gap: 0; }
.pp-chan-row {
  width: 100%; min-height: 44px; padding: 5px 8px;
  display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 10px; align-items: center;
  border: 0; border-radius: 8px; background: transparent; text-align: left; cursor: pointer;
  transition: background-color 120ms ease;
}
button.pp-chan-row:hover { background: var(--pp-hover); }
.pp-chan-avatar {
  width: 30px; height: 30px; border-radius: 50%; object-fit: cover;
  display: grid; place-items: center;
  background: var(--pp-well); color: var(--pp-text-2); font-size: 13px; font-weight: 800;
  box-shadow: 0 0 0 2px var(--pp-card), 0 0 0 3.5px var(--pp-live);
}
.pp-chan-avatar.pp-skel { box-shadow: none; }
.pp-chan-text { display: grid; gap: 2px; min-width: 0; }
.pp-chan-text b { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-chan-text small { font-size: 11.5px; color: var(--pp-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pp-chan-rate { display: grid; justify-items: end; gap: 4px; font-variant-numeric: tabular-nums; }
.pp-chan-rate b { font-size: 12.5px; font-weight: 700; }
.pp-chan-rate small { font-size: 10.5px; font-weight: 600; color: var(--pp-text-3); }
.pp-chan-bar { width: 56px; height: 4px; border-radius: 2px; background: var(--pp-well); overflow: hidden; }
.pp-chan-bar span { display: block; height: 100%; border-radius: 2px; background: var(--pp-chart); transform-origin: left; animation: pp-grow 700ms 150ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }

.pp-jump {
  width: 100%; min-height: 40px; padding: 4px 8px;
  display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 10px; align-items: center;
  border: 0; border-radius: 8px; background: transparent; text-align: left; cursor: pointer;
  transition: background-color 120ms ease;
}
.pp-jump:hover { background: var(--pp-hover); }
.pp-jump-icon { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--pp-tint); color: var(--pp-ink); }
.pp-jump-icon svg { width: 15px; height: 15px; }
.pp-jump-text { display: grid; gap: 2px; min-width: 0; }
.pp-jump-text b { font-size: 12.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-jump-text small { font-size: 11px; color: var(--pp-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-jump-go { font-size: 12px; font-weight: 700; color: var(--pp-ink); white-space: nowrap; }

.pp-quiet {
  width: 100%; min-height: 34px; margin-top: 8px;
  border: 0; border-radius: 8px;
  background: var(--pp-well); color: var(--pp-text);
  box-shadow: inset 0 0 0 1px var(--pp-line);
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: background-color 120ms ease;
}
.pp-quiet:hover { background: color-mix(in srgb, var(--pp-well) 85%, var(--pp-text)); }

.pp-skel { border-radius: 6px; background: var(--pp-well); animation: pp-pulse 1.2s ease-in-out infinite alternate; }

.pp-links { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pp-link {
  min-width: 0; min-height: 48px; padding: 7px 10px;
  display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 8px; align-items: center;
  border: 1px solid var(--pp-line); border-radius: 10px;
  background: var(--pp-card); box-shadow: var(--pp-shadow);
  text-align: left; cursor: pointer;
  animation: pp-rise 260ms cubic-bezier(0.2, 0.8, 0.2, 1) 60ms both;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.pp-link + .pp-link { animation-delay: 100ms; }
.pp-link:hover { border-color: var(--pp-line-strong); background: color-mix(in srgb, var(--pp-card) 92%, var(--pp-text)); }
.pp-link-icon { grid-row: span 2; width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; background: var(--pp-tint); color: var(--pp-ink); }
.pp-link-icon svg { width: 16px; height: 16px; }
.pp-link-label { display: flex; align-items: center; gap: 3px; font-size: 13px; font-weight: 650; white-space: nowrap; }
.pp-link-label svg { width: 12px; height: 12px; color: var(--pp-text-3); }
.pp-link-desc { font-size: 11px; color: var(--pp-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pp-foot { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 2px; font-size: 11px; color: var(--pp-text-3); }
.pp-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--pp-text-3); }
.pp-dot[data-tone="ok"] { background: var(--pp-ok); }
.pp-dot[data-tone="bad"] { background: var(--pp-bad); }
.pp-source { padding: 1px 5px; border-radius: 4px; box-shadow: 0 0 0 1px var(--pp-line-strong) inset; color: var(--pp-text-2); }
.pp-version { margin-left: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; }

@keyframes pp-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes pp-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pp-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes pp-halo { 0% { opacity: 0.45; transform: scale(1); } 70%, 100% { opacity: 0; transform: scale(3.2); } }
@keyframes pp-pulse { from { opacity: 0.55; } to { opacity: 1; } }
@keyframes pp-slide { to { transform: translateX(-50%); } }
@keyframes pp-grow { from { transform: scaleX(0); } }
@keyframes pp-beat { 0% { box-shadow: 0 0 0 0 rgba(235, 4, 0, 0.45); } 70%, 100% { box-shadow: 0 0 0 6px rgba(235, 4, 0, 0); } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
@media (forced-colors: active) {
  .pp-card, .pp-link, .pp-stat { border: 1px solid CanvasText; }
  .pp-badge { border: 1px solid CanvasText; }
}
`
