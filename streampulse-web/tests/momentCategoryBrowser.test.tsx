import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadedCategories, MomentCategoryBrowser } from '../src/ui/components/moments/MomentCategoryBrowser'
import * as categoryArtwork from '../src/lib/momentCategoryArtwork'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('loaded category navigation', () => {
  it('enriches an unfamiliar category from its exact broadcast metadata', async () => {
    const boxArtUrl = 'https://static-cdn.jtvnw.net/ttv-boxart/123-144x192.jpg'
    const load = vi.spyOn(categoryArtwork, 'loadCategoryArtwork').mockResolvedValue(new Map([['Unfamiliar category', {categoryId: '123', boxArtUrl}]]))
    const view = render(<MomentCategoryBrowser items={[{ category: 'Unfamiliar category', streamId: 'exact-stream' }]} selected="" onSelect={() => {}} />)
    await waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toBe(boxArtUrl))
    expect(load).toHaveBeenCalledWith('exact-stream')
  })
  it('uses verified artwork for the recent categories with missing metadata', () => {
    const categories = ['Grand Theft Auto V', 'IRL', 'Pokémon Brilliant Diamond/Shining Pearl', 'Super Mario Maker 2']
    const result = loadedCategories(categories.map(category => ({ category })))
    expect(result.every(item => item.boxArtUrl?.startsWith('https://static-cdn.jtvnw.net/ttv-boxart/'))).toBe(true)
    expect(result.find(item => item.name.startsWith('Pokémon'))?.boxArtUrl).toContain('1584745140-')
    expect(result.find(item => item.name === 'Grand Theft Auto V')?.boxArtUrl).toContain('32982_IGDB-')
  })
  it('counts only supplied categories without inventing a category for missing metadata', () => {
    expect(loadedCategories([{ category: 'Minecraft' }, {}, { category: 'Minecraft' }, { category: 'Just Chatting' }])).toEqual([
      { name: 'Just Chatting', count: 1, boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg' },
      { name: 'Minecraft', count: 2, boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/27471-144x192.jpg' },
    ])
  })
  it('uses supplied exact artwork for an otherwise unknown category', () => {
    const boxArtUrl = 'https://static-cdn.jtvnw.net/ttv-boxart/213490846-210x280.jpg'
    const result = loadedCategories([{ category: 'Wuthering Waves', categoryId: '213490846', boxArtUrl }])
    expect(result).toEqual([{ name: 'Wuthering Waves', count: 1, categoryId: '213490846', boxArtUrl }])
    const view = render(<MomentCategoryBrowser items={[{ category: 'Wuthering Waves', categoryId: '213490846', boxArtUrl }]} selected="" onSelect={() => {}} />)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(boxArtUrl)
    expect(view.container.querySelector('img')?.getAttribute('loading')).toBe('lazy')
  })
  it('accepts an authoritative IGDB box-art filename', () => {
    const boxArtUrl = 'https://static-cdn.jtvnw.net/ttv-boxart/213490846_IGDB-144x192.jpg'
    expect(loadedCategories([{ category: 'Wuthering Waves', categoryId: '213490846', boxArtUrl }])[0].boxArtUrl).toBe(boxArtUrl)
  })
  it('does not generate artwork from an explicit ID, even for a compatibility category', () => {
    for (const categoryId of ['27471', '999']) {
      expect(loadedCategories([{ category: 'Minecraft', categoryId }])).toEqual([
        { name: 'Minecraft', count: 1, categoryId },
      ])
    }
  })
  it('suppresses ambiguous artwork when one display name has distinct exact IDs', () => {
    const onSelect = vi.fn()
    const items = [
      { category: 'Shared name', categoryId: '111', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/111-144x192.jpg' },
      { category: 'Shared name', categoryId: '222', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/222-144x192.jpg' },
    ]
    expect(loadedCategories(items)).toEqual([{ name: 'Shared name', count: 2 }])
    const view = render(<MomentCategoryBrowser items={items} selected="" onSelect={onSelect} />)
    expect(view.container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Shared name 2 loaded moments' }))
    expect(onSelect).toHaveBeenCalledWith('Shared name')
  })
  it('rejects conflicting or unsafe supplied artwork at the render boundary', () => {
    const items = [
      { category: 'Unknown', categoryId: '111', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/222-144x192.jpg' },
      { category: 'Other', categoryId: '333', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/333-144x192.jpg?width=144' },
    ]
    const view = render(<MomentCategoryBrowser items={items} selected="" onSelect={() => {}} />)
    expect(view.container.querySelectorAll('img')).toHaveLength(0)
  })
  it('does not restore compatibility artwork after explicit metadata was rejected', () => {
    for (const item of [
      { category: 'Minecraft', categoryMetadataRejected: true as const },
      { category: 'Minecraft', categoryId: 'malformed' },
      { category: 'Minecraft', boxArtUrl: 'https://untrusted.invalid/box.jpg' },
    ]) {
      expect(loadedCategories([item])).toEqual([{ name: 'Minecraft', count: 1 }])
    }
  })
  it('makes a mixed valid and rejected same-name group neutral', () => {
    const boxArtUrl = 'https://static-cdn.jtvnw.net/ttv-boxart/27471-210x280.jpg'
    expect(loadedCategories([
      { category: 'Minecraft', categoryId: '27471', boxArtUrl },
      { category: 'Minecraft', categoryMetadataRejected: true },
    ])).toEqual([{ name: 'Minecraft', count: 2, categoryId: '27471' }])
  })
  it('selects and clears categories with visible counts and pressed state', () => {
    const onSelect = vi.fn()
    const props = { items: [{ category: 'Minecraft' }], onSelect }
    const view = render(<MomentCategoryBrowser {...props} selected="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Minecraft 1 loaded moment' }))
    expect(onSelect).toHaveBeenLastCalledWith('Minecraft')
    view.rerender(<MomentCategoryBrowser {...props} selected="Minecraft" />)
    expect(screen.getByRole('button', { name: 'Minecraft 1 loaded moment' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Minecraft 1 loaded moment' }))
    expect(onSelect).toHaveBeenLastCalledWith('')
  })
  it('retains the category action when artwork fails', () => {
    const view = render(<MomentCategoryBrowser items={[{ category: 'Minecraft' }]} selected="" onSelect={() => {}} />)
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')).toBeNull()
    expect(screen.getByRole('button', { name: 'Minecraft 1 loaded moment' })).toBeTruthy()
  })
})
