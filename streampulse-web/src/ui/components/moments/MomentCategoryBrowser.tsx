import { useEffect, useState } from 'react'
import { getBackendUrl } from '../../../lib/apiClient'
import { isExactCategoryBoxArt, loadCategoryArtwork, type CategoryArtworkItem } from '../../../lib/momentCategoryArtwork'
import type { RankedFacet } from '../../../lib/discoveryCatalogue'

// Artwork is navigation metadata only. Never use it as a moment preview.
const artworkIds: Record<string, string> = {
  'Just Chatting': '509658', Minecraft: '27471', VALORANT: '516575',
  'Counter-Strike': '32399', 'League of Legends': '21779',
  // Verified from the exact broadcast games responses, 2026-09-08.
  'Grand Theft Auto V': '32982_IGDB', IRL: '509672',
  'Pokémon Brilliant Diamond/Shining Pearl': '1584745140',
  'Super Mario Maker 2': '511399_IGDB',
}

type CategoryItem = CategoryArtworkItem
export function loadedCategories(items: ReadonlyArray<CategoryItem>) {
  const groups = new Map<string, { count: number; ids: Set<string>; urls: Set<string>; rejected: boolean }>()
  for (const item of items) if (item.category) {
    const group = groups.get(item.category) ?? { count: 0, ids: new Set<string>(), urls: new Set<string>(), rejected: false }
    group.count++
    group.rejected ||= item.categoryMetadataRejected === true
    if (item.categoryId && /^\d{1,20}$/.test(item.categoryId)) {
      group.ids.add(item.categoryId)
      if (item.boxArtUrl && isExactCategoryBoxArt(item.boxArtUrl, item.categoryId)) group.urls.add(item.boxArtUrl)
      else if (item.boxArtUrl) group.rejected = true
    } else if (item.categoryId || item.boxArtUrl) {
      group.rejected = true
    }
    groups.set(item.category, group)
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, group]) => {
    const id = group.ids.size === 1 ? [...group.ids][0] : undefined
    const suppliedUrl = !group.rejected && id && group.urls.size === 1 ? [...group.urls][0] : undefined
    const fallbackId = artworkIds[name]
    // Compatibility artwork is name-based and is safe only when no explicit identity was supplied.
    const boxArtUrl = suppliedUrl ?? (!group.rejected && group.ids.size === 0 && fallbackId
      ? `https://static-cdn.jtvnw.net/ttv-boxart/${fallbackId}-144x192.jpg`
      : undefined)
    return { name, count: group.count, ...(id ? { categoryId: id } : {}), ...(boxArtUrl ? { boxArtUrl } : {}) }
  })
}

export function categoryPresentationArt(group: ReturnType<typeof loadedCategories>[number], resolutions?: ReadonlyMap<string, { boxArtUrl?: string }>): string | undefined {
  return group.boxArtUrl ?? (resolutions && typeof resolutions.get === 'function' ? resolutions.get(group.categoryId ? `id:${group.categoryId}` : `name:${group.name}`)?.boxArtUrl : undefined)
}

export function CategoryArtwork({ name, boxArtUrl }: { name: string; boxArtUrl?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  return <span className="moments-category-art" aria-hidden="true">
    {boxArtUrl && boxArtUrl !== failedUrl ? <img src={boxArtUrl} alt="" loading="lazy" onError={() => setFailedUrl(boxArtUrl)} /> : <span>{name.slice(0, 2)}</span>}
  </span>
}

export function MomentCategoryBrowser(props: {
  items?: ReadonlyArray<CategoryItem>; facets?: ReadonlyArray<RankedFacet>; resolutions?: ReadonlyMap<string, { boxArtUrl?: string }>; selected: string; onSelect: (category: string) => void
}) {
  if (!props.facets) return <LoadedCategoryBrowser items={props.items ?? []} selected={props.selected} onSelect={props.onSelect} />
  return <section className="moments-category-browser moments-ranked-categories" aria-label="Browse measured categories">
    <div className="moments-category-heading"><h2>Browse categories</h2><button type="button" aria-pressed={!props.selected} onClick={() => props.onSelect('')}>All categories</button></div>
    <div className="moments-category-track">{props.facets.map(facet => {
      const key = facet.categoryMissing ? '__unknown__' : facet.category
      const name = facet.categoryMissing ? 'Unknown (category unavailable)' : facet.category
      const id = !facet.categoryMissing ? artworkIds[facet.category] : undefined
      return <button type="button" key={JSON.stringify([facet.categoryMissing, facet.category])} aria-pressed={props.selected === key} onClick={() => props.onSelect(props.selected === key ? '' : key)}>
        <CategoryArtwork name={name} boxArtUrl={id ? `https://static-cdn.jtvnw.net/ttv-boxart/${id}-144x192.jpg` : undefined} />
        <span><strong>{name}</strong><small>{facet.count.toLocaleString()} ranked {facet.count === 1 ? 'moment' : 'moments'}</small></span>
      </button>
    })}</div>
  </section>
}

function LoadedCategoryBrowser({ items, selected, onSelect }: {
  items: ReadonlyArray<CategoryItem>; selected: string; onSelect: (category: string) => void
}) {
  const initial = loadedCategories(items)
  const pending = [...new Set(items.filter(item => item.streamId && item.category && !item.categoryMetadataRejected
    && !item.categoryId && !item.boxArtUrl && !initial.find(group => group.name === item.category)?.boxArtUrl).map(item => item.streamId!))].slice(0, 8)
  const requestKey = JSON.stringify([getBackendUrl(), pending])
  const [enrichment, setEnrichment] = useState<{ key: string; rows: Record<string, Map<string, { categoryId: string; boxArtUrl: string }>> }>({ key: '', rows: {} })
  useEffect(() => {
    let active = true
    setEnrichment({ key: requestKey, rows: {} })
    void (async () => {
      // At most two cosmetic reads at a time, and eight exact streams per view.
      for (let start = 0; active && start < pending.length; start += 2) {
        await Promise.all(pending.slice(start, start + 2).map(async stream => {
          const rows = await loadCategoryArtwork(stream)
          if (active) setEnrichment(previous => ({ key: requestKey, rows: { ...(previous.key === requestKey ? previous.rows : {}), [stream]: rows } }))
        }))
      }
    })()
    return () => { active = false }
    // Exact streams and backend origin are encoded in this bounded key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])
  const categories = loadedCategories(items.map(item => {
    if (item.categoryId || item.boxArtUrl || item.categoryMetadataRejected || !item.streamId || !item.category || enrichment.key !== requestKey) return item
    const art = enrichment.rows[item.streamId]?.get(item.category)
    return art ? { ...item, ...art } : item
  }))
  if (!categories.length) return null
  return <section className="moments-category-browser moments-category-browser--covers" aria-label="Browse loaded categories" aria-description="Counts reflect loaded detections matching your search and time filters, not all of Twitch.">
    <div className="moments-category-heading"><h2>Browse categories</h2></div>
    <div className="moments-category-track">
      <button type="button" aria-pressed={!selected} onClick={() => onSelect('')}>All categories <span>{items.length}</span></button>
      {categories.map(({ name, count, boxArtUrl }) => <button type="button" key={name} aria-pressed={selected === name} onClick={() => onSelect(selected === name ? '' : name)}>
        <CategoryArtwork name={name} boxArtUrl={boxArtUrl} /><span><strong>{name}</strong><small>{count} loaded {count === 1 ? 'moment' : 'moments'}</small></span>
      </button>)}
    </div>
  </section>
}
