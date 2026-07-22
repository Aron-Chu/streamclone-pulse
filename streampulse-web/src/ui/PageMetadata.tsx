import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { resolvePageMetadata } from '../lib/pageMetadata'

const SITE_ORIGIN = 'https://streampulse.stream'

function upsertMeta(
  selector: string,
  attribute: 'name' | 'property',
  key: string,
  value: string,
): void {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.setAttribute('content', value)
}

export function PageMetadata() {
  const { pathname, search } = useLocation()

  useEffect(() => {
    const metadata = resolvePageMetadata(pathname, search)
    const canonicalUrl = new URL(metadata.canonicalPath, SITE_ORIGIN).toString()
    document.title = metadata.title
    upsertMeta('meta[name="description"]', 'name', 'description', metadata.description)
    upsertMeta('meta[name="robots"]', 'name', 'robots', metadata.robots)
    upsertMeta('meta[property="og:title"]', 'property', 'og:title', metadata.title)
    upsertMeta('meta[property="og:description"]', 'property', 'og:description', metadata.description)
    upsertMeta('meta[property="og:url"]', 'property', 'og:url', canonicalUrl)
    upsertMeta('meta[name="twitter:title"]', 'name', 'twitter:title', metadata.title)
    upsertMeta('meta[name="twitter:description"]', 'name', 'twitter:description', metadata.description)

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = canonicalUrl
  }, [pathname, search])

  return null
}
