import { useLocation } from 'react-router-dom'
import reviewedMetadata from '../generated/recap-page-metadata.json'
import { resolvePageMetadata } from '../lib/pageMetadata'
import { InstallCta } from './components/InstallCta'
import { AnalyticsPreferences } from './components/AnalyticsPreferences'

/** The reviewed summary's template for exactly this page, or null (unapproved page, or an in-app visit). */
function reviewedRecapTemplate(pathname: string, search: string): HTMLTemplateElement | null {
  const metadata = resolvePageMetadata(pathname, search)
  if (metadata.robots !== 'index,follow' || !Object.prototype.hasOwnProperty.call(reviewedMetadata, metadata.canonicalPath)) return null
  const template = document.getElementById('reviewed-recap-summary')
  return template instanceof HTMLTemplateElement && template.dataset.canonicalPath === metadata.canonicalPath ? template : null
}

/** True when this page shows the reviewed summary, whose h1 is then the page's heading. */
export function useReviewedRecapShown(): boolean {
  const { pathname, search } = useLocation()
  return reviewedRecapTemplate(pathname, search) !== null
}

/** Keep the reviewed initial summary useful after the interactive app boots.
 * The inert template is produced only by the escaped, strict build-time renderer.
 * It is never populated from a URL, API response or arbitrary client HTML.
 */
export function ReviewedRecapSummary() {
  const { pathname, search } = useLocation()
  const template = reviewedRecapTemplate(pathname, search)
  if (!template) return null
  return <section aria-label="Reviewed reaction summary" data-reviewed-recap-mounted>
    <div dangerouslySetInnerHTML={{ __html: template.innerHTML }} />
    <div className="public-document panel">
      <InstallCta />
      <AnalyticsPreferences />
    </div>
  </section>
}
