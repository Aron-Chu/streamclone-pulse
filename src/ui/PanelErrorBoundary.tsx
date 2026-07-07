import { Component, type ErrorInfo, type ReactNode } from 'react'
import { theme } from './theme.ts'

interface PanelErrorBoundaryProps {
  children: ReactNode
}

interface PanelErrorBoundaryState {
  error: Error | null
}

/** Prevent a single chart/runtime throw from blanking the whole Pulse sidebar. */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Pulse panel render]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <section style={styles.block}>
          <h2 style={styles.title}>Pulse panel error</h2>
          <p style={styles.text}>{this.state.error.message}</p>
          <p style={styles.hint}>Reload the Twitch tab. If this persists, report the message above.</p>
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
