import { Component, type ErrorInfo, type ReactNode } from 'react'
import { requestExtensionErrorShownAnalytics } from '../shared/extensionAnalytics.ts'
import { EXTENSION_DIAGNOSTICS_INGEST_ENABLED } from '../shared/diagnosticsConsent.ts'
import {
  classifyDiagnosticsError,
  emitExtensionDiagnostic,
  framesFromErrorStack,
} from '../shared/extensionDiagnostics.ts'
import { theme } from './theme.ts'

interface PanelErrorBoundaryProps {
  children: ReactNode
}

interface PanelErrorBoundaryState {
  hasError: boolean
}

/** Prevent a single chart/runtime throw from blanking the whole Pulse sidebar. */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): PanelErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    // Diagnostics upload is compiled off, so a report would be dropped unsent.
    // This check keeps the report code out of the content script.
    if (EXTENSION_DIAGNOSTICS_INGEST_ENABLED) {
      // NEVER send error.message or raw stack — enums + sanitized frames only.
      void emitExtensionDiagnostic({
        feature: 'overlay',
        event: 'render_error',
        error: classifyDiagnosticsError(error),
        frames: framesFromErrorStack(error.stack),
      })
    }
    // User-visible error UI is about to render — coarse analytics only (consent + kill switch gated).
    requestExtensionErrorShownAnalytics()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // The error class goes to diagnostics above, never into viewer copy.
      return (
        <section style={styles.block} data-testid="pulse-panel-error">
          <h2 style={styles.title}>Pulse panel error</h2>
          <p style={styles.text}>Something went wrong rendering this panel.</p>
          <p style={styles.hint}>Reload the Twitch tab. If this persists, use Send feedback in settings.</p>
        </section>
      )
    }
    return this.props.children
  }
}

const styles = {
  block: {
    padding: 12,
    background: theme.panelElevated,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    margin: 10,
  },
  title: { fontSize: 14, fontWeight: 800, margin: '0 0 6px' },
  text: { fontSize: 12, color: theme.textSecondary, margin: '0 0 8px', wordBreak: 'break-word' as const },
  hint: { fontSize: 11, color: theme.textMuted, margin: 0 },
}
