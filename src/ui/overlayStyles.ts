import { theme } from './theme.ts'

export const overlayBaseStyles = `
  :host {
    display: block;
    font-family: ${theme.font};
    color: ${theme.textPrimary};
    pointer-events: none;
    position: fixed;
    z-index: 2147483000;
    isolation: isolate;
    box-sizing: border-box;
  }
  * { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; }
  /* Keep mouse focus quiet while preserving the browser keyboard indicator. */
  button:focus:not(:focus-visible), input:focus:not(:focus-visible),
  select:focus:not(:focus-visible), textarea:focus:not(:focus-visible) { outline: none; }
  .pulse-no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
  .pulse-no-scrollbar::-webkit-scrollbar { display: none; }
  .pulse-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    pointer-events: none;
    font-family: ${theme.font};
    color: ${theme.textPrimary};
  }
  .pulse-shell {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    pointer-events: auto;
    width: 100%;
    min-height: 0;
    overflow: auto;
    background: ${theme.panelGlass};
    border: 1px solid ${theme.borderAccent};
    border-radius: ${theme.radiusPanel}px;
    box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    backdrop-filter: blur(14px);
    color: ${theme.textPrimary};
    font-family: ${theme.font};
    animation: pulse-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .placement-right {
    position: fixed;
    top: 50%;
    right: 12px;
    transform: translateY(-50%);
    width: min(392px, calc(100vw - 24px));
    max-height: min(82vh, 760px);
    height: auto;
    flex: 0 0 auto;
  }
  .placement-bottom {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    width: min(860px, calc(100vw - 32px));
    max-height: min(52vh, 560px);
    height: auto;
    flex: 0 0 auto;
  }
  .placement-sidebar.pulse-shell {
    height: 100%;
    min-height: 100%;
  }
  .mode-mini.placement-right {
    top: auto;
    bottom: 88px;
    right: 12px;
    transform: none;
    width: min(420px, calc(100vw - 24px));
    max-height: 72px;
    overflow: hidden;
  }
  .mode-mini.placement-bottom {
    max-height: 72px;
    overflow: hidden;
  }
  .mode-collapsed.placement-right {
    top: auto;
    bottom: 24px;
    right: 12px;
    transform: none;
    width: auto;
    max-height: none;
    border-radius: 999px;
    overflow: visible;
  }
  .mode-collapsed.placement-bottom { bottom: 16px; }
  .placement-right:not(.mode-mini):not(.mode-collapsed) { animation-name: pulse-in-right; }
  .placement-bottom:not(.mode-mini):not(.mode-collapsed) { animation-name: pulse-in-bottom; }
  .pulse-hidden { display: none !important; }
  .pulse-sidebar-panel.pulse-shell {
    background: ${theme.bgCanvas};
    border: 0;
    border-radius: 0;
    box-shadow: none;
    backdrop-filter: none;
  }
`

// The shared component stylesheet is emitted as content/shadow.css and linked
// inside each shadow root. Keeping only the overlay shell inline avoids paying
// for the full stylesheet in the size-gated content-script IIFE.
export const overlayStyles = overlayBaseStyles
