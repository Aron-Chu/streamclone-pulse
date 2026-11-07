// Sitemap <lastmod> only where a page states its own date. A build date would
// restamp unchanged pages on every deploy, and a commit date is not when the
// page went live, so pages without a stated date get no <lastmod>.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The "Last updated: November 2, 2026" line a page shows, as 2026-11-02, or null. */
export function statedUpdateDate(html) {
  const match = /Last updated:\s*([A-Z][a-z]+) (\d{1,2}), (\d{4})/.exec(html)
  if (!match) return null
  const month = MONTHS.indexOf(match[1])
  const day = Number(match[2])
  const year = Number(match[3])
  const date = new Date(Date.UTC(year, month, day))
  if (month < 0 || date.getUTCMonth() !== month || date.getUTCDate() !== day) throw new Error(`Unreadable page date: ${match[0]}`)
  return date.toISOString().slice(0, 10)
}

/** Adds <lastmod> to the sitemap entries named in `dates` (absolute URL → YYYY-MM-DD); every other entry is left as it is. */
export function sitemapWithStatedDates(source, dates) {
  return source.replace(/<url><loc>([^<]+)<\/loc><\/url>/g, (entry, loc) => {
    const date = dates.get(loc)
    return date ? `<url><loc>${loc}</loc><lastmod>${date}</lastmod></url>` : entry
  })
}
