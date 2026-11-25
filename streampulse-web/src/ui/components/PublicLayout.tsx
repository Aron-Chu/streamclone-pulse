import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { PageErrorBoundary } from '../PortalErrorBoundary'

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <SiteHeader mainId="public-main" variant="public" />
      <main className="app-main" id="public-main" tabIndex={-1}><PageErrorBoundary>{children}</PageErrorBoundary></main>
      <SiteFooter />
    </div>
  )
}
