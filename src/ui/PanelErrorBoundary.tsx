import { Component, type ErrorInfo, type ReactNode } from 'react'
import { requestExtensionErrorShownAnalytics } from '../shared/extensionAnalytics.ts'
import {
  classifyDiagnosticsError,
  emitExtensionDiagnostic,
  framesFromErrorStack,
} from '../shared/extensionDiagnostics.ts'
import { theme } from './theme.ts'

interface PanelErrorBoundaryProps {
  children: ReactNode
  /** Override for tests. */
  emit?: typeof emitExtensionDiagnostic
}

interface PanelErrorBoundaryState {
  hasError: boolean
  errorClass: 'type_error' | 'network_error' | 'timeout' | 'abort' | 'unknown' | null
}

/** Prevent a single chart/runtime throw from blanking the whole Pulse sidebar. */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { hasError: false, errorClass: null }

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return {
      hasError: true,
      errorClass: classifyDiagnosticsError(error),
    }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    // NEVER send error.message or raw stack — enums + sanitized frames only.
    const emit = this.props.emit ?? emitExtensionDiagnostic
    void emit({
      feature: 'overlay',
      event: 'render_error',
      error: classifyDiagnosticsError(error),
      frames: framesFromErrorStack(error.stack),
    })
    // User-visible error UI is about to render — coarse analytics only (consent + kill switch gated).
    requestExtensionErrorShownAnalytics()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const code = this.state.errorClass ?? 'unknown'
      return (
        <section style={styles.block} data-testid="pulse-panel-error">
          <h2 style={styles.title}>Pulse panel error</h2>
          <p style={styles.text}>Something went wrong rendering this panel ({code}).</p>
          <p style={styles.hint}>Reload the Twitch tab. If this persists, open Options and report a support case.</p>
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
