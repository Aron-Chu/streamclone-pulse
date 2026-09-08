import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DiscoveryCalendar } from '../src/ui/components/moments/DiscoveryCalendar'
import { MomentCategoryBrowser } from '../src/ui/components/moments/MomentCategoryBrowser'

vi.mock('../src/ui/components/moments/DiscoveryYearOverview', () => ({
  DiscoveryYearOverview: ({ onDay, selectedDay }: { onDay: (day: string) => void; selectedDay?: string }) =>
    <button data-selected-day={selectedDay} onClick={() => onDay('2025-09-02')}>Fixture year day</button>,
}))
afterEach(cleanup)

it('keeps year presentation when opening a day and passes exact selected UTC day to the heatmap', () => {
  const onChange = vi.fn()
  render(<DiscoveryCalendar scope={{ creator: 'creator', month: '2025-09', day: '2025-09-01' }} loading={false}
    presentation={{ mode: 'year', year: '2025', years: 1, measure: 'detections' }} onChange={onChange}
    onPresentationChange={() => {}} onRecent={() => {}} />)
  const day = screen.getByRole('button', { name: 'Fixture year day' })
  expect(day.getAttribute('data-selected-day')).toBe('2025-09-01')
  fireEvent.click(day)
  expect(onChange).toHaveBeenCalledWith({ month: '2025-09', day: '2025-09-02', calendar: 'year' })
})

it('places All and artwork categories in one cover navigation strip with accessible count scope', () => {
  render(<MomentCategoryBrowser items={[{ category: 'Minecraft' }, { category: 'Unmeasured art' }]} selected="" onSelect={() => {}} />)
  const all = screen.getByRole('button', { name: 'All categories 2' })
  expect(all.closest('.moments-category-track')).not.toBeNull()
  expect(document.querySelector('.moments-category-browser--covers')).not.toBeNull()
  expect(screen.getByRole('region', { name: 'Browse loaded categories' }).getAttribute('aria-description')).toContain('loaded detections')
})
