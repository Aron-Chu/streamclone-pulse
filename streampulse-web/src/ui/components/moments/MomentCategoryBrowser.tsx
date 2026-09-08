import { useState } from 'react'

import { categoryArtworkKey, isExactCategoryBoxArt, type CategoryArtworkMap } from '../../../lib/categoryArtwork'

type CategoryItem = { category?: string; categoryId?: string; boxArtUrl?: string; categoryMetadataRejected?: true }
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
    // Different approved resolutions of one exact ID are not conflicting identities.
    // Stable ordering also avoids reloading artwork when feed order changes.
    const suppliedUrl = !group.rejected && id ? [...group.urls].sort()[0] : undefined
    const boxArtUrl = suppliedUrl
    return { name, count: group.count, ...(id ? { categoryId: id } : {}), ...(boxArtUrl ? { boxArtUrl } : {}), ...(group.rejected || group.ids.size > 1 ? { rejected: true as const } : {}) }
  })
}

export function categoryPresentationArt(group: ReturnType<typeof loadedCategories>[number], resolutions?: CategoryArtworkMap): string | undefined {
  if (group.rejected) return undefined
  return group.boxArtUrl ?? resolutions?.get(categoryArtworkKey(group))?.boxArtUrl
}

export function CategoryArtwork({ name, boxArtUrl }: { name: string; boxArtUrl?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const [loadedUrl, setLoadedUrl] = useState<string>()
  const state = !boxArtUrl ? 'unavailable' : boxArtUrl === failedUrl ? 'failed' : boxArtUrl === loadedUrl ? 'ready' : 'loading'
  return <span className="moments-category-art" aria-hidden="true" data-artwork-state={state}>
    {boxArtUrl && boxArtUrl !== failedUrl ? <img key={boxArtUrl} src={boxArtUrl} alt="" loading="lazy" decoding="async" onLoad={() => setLoadedUrl(boxArtUrl)} onError={() => setFailedUrl(boxArtUrl)} /> : <span>{name.slice(0, 2)}</span>}
  </span>
}

export function MomentCategoryBrowser({ items, selected, onSelect, resolutions }: {
  items: ReadonlyArray<CategoryItem>; selected: string; onSelect: (category: string) => void; resolutions?: CategoryArtworkMap
}) {
  const categories = loadedCategories(items)
  if (!categories.length) return null
  return <section className="moments-category-browser moments-category-browser--covers" aria-label="Browse loaded categories" aria-description="Counts reflect loaded detections matching your search and time filters, not all of Twitch.">
    <h2>Categories</h2>
    <div className="moments-category-track" onFocus={event => {
      // Nearest scrolling can snap back to a neighbour and clip this keyboard
      // target. Align its own snap point; pointer focus must not move a click.
      if (event.target instanceof HTMLButtonElement && event.target.matches(':focus-visible')) {
        event.target.scrollIntoView?.({ block: 'nearest', inline: 'start' })
      }
    }}><button type="button" data-category-action="all" aria-pressed={!selected} onClick={() => onSelect('')}>All categories <span>{items.length}</span></button>{categories.map(group => <button type="button" key={group.name} data-category-action="category" aria-pressed={selected === group.name} onClick={() => onSelect(selected === group.name ? '' : group.name)}>
      <CategoryArtwork name={group.name} boxArtUrl={categoryPresentationArt(group, resolutions)} /><span><strong>{group.name}</strong><small>{group.count} loaded {group.count === 1 ? 'detection' : 'detections'}</small></span>
    </button>)}</div>
  </section>
}
