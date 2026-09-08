import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadedCategories, MomentCategoryBrowser, categoryPresentationArt } from '../src/ui/components/moments/MomentCategoryBrowser'

afterEach(cleanup)
describe('loaded category navigation', () => {
  it('aligns keyboard focus to its own snap point without moving pointer focus or selecting', () => {
    const onSelect = vi.fn()
    render(<MomentCategoryBrowser items={[{ category: 'Minecraft' }]} selected="" onSelect={onSelect} />)
    const button = screen.getByRole('button', { name: 'Minecraft 1 loaded detection' })
    const scroll = vi.fn()
    Object.defineProperty(button, 'scrollIntoView', { configurable: true, value: scroll })
    const matches = vi.spyOn(button, 'matches').mockReturnValue(true)
    fireEvent.focus(button)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'start' })
    matches.mockReturnValue(false)
    fireEvent.focus(button)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    matches.mockRestore()
  })
  it('preserves supplied art and rejected/conflicting identities over catalogue hydration', () => {
    const supplied = 'https://static-cdn.jtvnw.net/ttv-boxart/1-120x160.jpg'
    const resolutions = new Map([['id:1', { status: 'resolved' as const, boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1-210x280.jpg' }], ['name:Same', { status: 'resolved' as const, boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/2-210x280.jpg' }]])
    const ready = loadedCategories([{ category: 'Same', categoryId: '1', boxArtUrl: supplied }])[0]
    expect(categoryPresentationArt(ready, resolutions)).toBe(supplied)
    const conflict = loadedCategories([{ category: 'Same', categoryId: '1' }, { category: 'Same', categoryId: '2' }])[0]
    expect(categoryPresentationArt(conflict, resolutions)).toBeUndefined()
    const rejected = loadedCategories([{ category: 'Same', categoryMetadataRejected: true }])[0]
    expect(categoryPresentationArt(rejected, resolutions)).toBeUndefined()
  })
  it('counts only supplied categories without inventing a category for missing metadata', () => {
    expect(loadedCategories([{ category: 'Minecraft' }, {}, { category: 'Minecraft' }, { category: 'Just Chatting' }])).toEqual([
      { name: 'Just Chatting', count: 1 },
      { name: 'Minecraft', count: 2 },
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
  it('keeps deterministic artwork for multiple approved sizes of the same category', () => {
    const items = ['210x280', '144x192'].map(size => ({ category: 'Minecraft', categoryId: '27471',
      boxArtUrl: `https://static-cdn.jtvnw.net/ttv-boxart/27471-${size}.jpg` }))
    expect(loadedCategories(items)[0].boxArtUrl).toBe(items[1].boxArtUrl)
    expect(loadedCategories([...items].reverse())).toEqual(loadedCategories(items))
  })
  it('recovers replacement artwork and exposes image state without changing navigation', () => {
    const item = { category: 'Minecraft', categoryId: '27471', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/27471-144x192.jpg' }
    const view = render(<MomentCategoryBrowser items={[item]} selected="" onSelect={() => {}} />)
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('[data-artwork-state="failed"]')).toBeTruthy()
    view.rerender(<MomentCategoryBrowser items={[{ ...item, boxArtUrl: item.boxArtUrl.replace('144x192', '210x280') }]} selected="Minecraft" onSelect={() => {}} />)
    fireEvent.load(view.container.querySelector('img')!)
    expect(view.container.querySelector('[data-artwork-state="ready"]')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-category-action]')).toHaveLength(2)
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
    expect(loadedCategories(items)).toEqual([{ name: 'Shared name', count: 2, rejected: true }])
    const view = render(<MomentCategoryBrowser items={items} selected="" onSelect={onSelect} />)
    expect(view.container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Shared name 2 loaded detections' }))
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
      expect(loadedCategories([item])).toEqual([{ name: 'Minecraft', count: 1, rejected: true }])
    }
  })
  it('makes a mixed valid and rejected same-name group neutral', () => {
    const boxArtUrl = 'https://static-cdn.jtvnw.net/ttv-boxart/27471-210x280.jpg'
    expect(loadedCategories([
      { category: 'Minecraft', categoryId: '27471', boxArtUrl },
      { category: 'Minecraft', categoryMetadataRejected: true },
    ])).toEqual([{ name: 'Minecraft', count: 2, categoryId: '27471', rejected: true }])
  })
  it('selects and clears categories with visible counts and pressed state', () => {
    const onSelect = vi.fn()
    const props = { items: [{ category: 'Minecraft' }], onSelect }
    const view = render(<MomentCategoryBrowser {...props} selected="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Minecraft 1 loaded detection' }))
    expect(onSelect).toHaveBeenLastCalledWith('Minecraft')
    view.rerender(<MomentCategoryBrowser {...props} selected="Minecraft" />)
    expect(screen.getByRole('button', { name: 'Minecraft 1 loaded detection' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Minecraft 1 loaded detection' }))
    expect(onSelect).toHaveBeenLastCalledWith('')
  })
  it('retains the category action when artwork fails', () => {
    const view = render(<MomentCategoryBrowser items={[{ category: 'Minecraft', categoryId: '27471', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/27471-210x280.jpg' }]} selected="" onSelect={() => {}} />)
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')).toBeNull()
    expect(screen.getByRole('button', { name: 'Minecraft 1 loaded detection' })).toBeTruthy()
  })
})
