const TWITCH_BOX_ART_HOST = 'static-cdn.jtvnw.net'
const TWITCH_BOX_ART_PATH = /^\/ttv-boxart\/[^/]+-\d+x\d+\.(?:jpe?g|png)$/i
const artPromiseCache = new Map<string, Promise<string | null>>()

export function twitchCategorySlug(gameName: string): string | null {
  const slug = gameName
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || null
}

export function normalizeTwitchBoxArt(raw: string | null | undefined): string | null {
  if (!raw || raw.includes('{width}') || raw.includes('{height}')) return null
  try {
    const url = new URL(raw.replace(/&amp;/g, '&'))
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== TWITCH_BOX_ART_HOST) return null
    if (!TWITCH_BOX_ART_PATH.test(url.pathname)) return null
    url.pathname = url.pathname.replace(/-\d+x\d+(\.(?:jpe?g|png))$/i, '-144x192$1')
    return url.toString()
  } catch {
    return null
  }
}

export function categoryBoxArtCandidates(categoryId: string | undefined): string[] {
  const id = categoryId?.trim()
  if (!id || !/^\d{1,20}$/.test(id)) return []
  return [
    `https://${TWITCH_BOX_ART_HOST}/ttv-boxart/${id}-144x192.jpg`,
    `https://${TWITCH_BOX_ART_HOST}/ttv-boxart/${id}_IGDB-144x192.jpg`,
  ]
}

export function gameArtCandidates(boxArtUrl?: string, categoryId?: string): string[] {
  const explicit = normalizeTwitchBoxArt(boxArtUrl)
  return Array.from(new Set([...(explicit ? [explicit] : []), ...categoryBoxArtCandidates(categoryId)]))
}

export function extractTwitchDirectoryBoxArt(html: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of metaTags) {
    if (!/\bproperty=["']og:image["']/i.test(tag) && !/\bname=["']twitter:image["']/i.test(tag)) continue
    const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1]
    const normalized = normalizeTwitchBoxArt(content)
    if (normalized) return normalized
  }
  return null
}

export async function fetchTwitchDirectoryBoxArt(
  gameName: string,
  options: { fetchImpl?: typeof fetch; origin?: string } = {},
): Promise<string | null> {
  const slug = twitchCategorySlug(gameName)
  if (!slug) return null
  const fetchImpl = options.fetchImpl ?? fetch
  const origin = options.origin ?? (typeof location !== 'undefined' ? location.origin : 'https://www.twitch.tv')
  const key = `${origin}:${slug}`
  const cached = artPromiseCache.get(key)
  if (cached) return await cached

  const pending = (async () => {
    try {
      const response = await fetchImpl(`${origin}/directory/category/${encodeURIComponent(slug)}`, {
        cache: 'force-cache',
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
      })
      if (!response.ok) return null
      return extractTwitchDirectoryBoxArt(await response.text())
    } catch {
      return null
    }
  })()
  artPromiseCache.set(key, pending)
  return await pending
}
