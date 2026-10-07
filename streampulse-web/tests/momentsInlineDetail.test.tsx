import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import * as availabilityTransport from '../src/lib/discoveryAvailability'
import * as minuteWindow from '../src/lib/momentMinuteWindow'
import { clearRankedFeatureCheckForTests } from '../src/hooks/useRankedFeatureAvailability'
import { fromHubMoment } from '../src/lib/discoveryMoments'
import { toggleSavedMoment } from '../src/lib/savedDiscoveryMoments'
import { MomentRow } from '../src/ui/components/moments/MomentRow'

vi.mock('../src/hooks/useMomentProfiles', () => ({ useMomentProfiles: (rows: unknown) => rows }))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
const { hub, row } = vi.hoisted(() => {
  const at = Date.now() - 60_000
  const row = (login: string, streamId: string, offsetSeconds: number, label: string, category: string, minutesAgo: number) => ({
    login, displayName: login, streamId, offsetSeconds, label, kind: 'chat_spike', chatPerMin: 200, emotesPerMin: 40, category, at: at - minutesAgo * 60_000, score: 80,
  })
  return { row, hub: {
    data: { generatedAt: new Date().toISOString(), livePulseMoments: [row('xqc', 's1', 60, 'Chat spike', 'Just Chatting', 0), row('sodapoppin', 's2', 240, 'Emote spike', 'Minecraft', 5)] } as { generatedAt: string; livePulseMoments: ReturnType<typeof row>[] },
    loading: false, refreshing: false, error: null as string | null, loadSource: 'network', hubEndpointOk: true, refresh: (() => {}) as () => void,
  } }
})
vi.mock('../src/hooks/usePublicHubData', () => ({ usePublicHubData: () => hub }))
// Browser history steps back a task later; MemoryRouter settles at once. `hold` keeps a
// step back until the test releases it, `drop` loses it, as a browser that never pops would.
const { stepBack } = vi.hoisted(() => ({ stepBack: { mode: 'real' as 'real' | 'hold' | 'drop', held: [] as Array<() => void> } }))
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  const { useCallback } = await import('react')
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate()
      return useCallback(((...args: Parameters<typeof navigate>) => {
        if (args[0] === -1 && stepBack.mode !== 'real') {
          if (stepBack.mode === 'hold') stepBack.held.push(() => void navigate(-1))
          return
        }
        return navigate(...(args as [never]))
      }) as typeof navigate, [navigate])
    },
  }
})

let currentUrl = ''
/** The history entry on screen: stepping back returns to an earlier entry's own key. */
let currentKey = ''
/** Browser Back. */
let historyBack: () => void = () => {}
function UrlProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  currentUrl = location.pathname + location.search
  currentKey = location.key
  historyBack = () => void navigate(-1)
  return null
}
const tree = (url: string) => <MemoryRouter initialEntries={[url]}><AnalyticsMomentsPage /><UrlProbe /></MemoryRouter>
const renderMoments = (url = '/analytics/moments') => render(tree(url))
const rows = () => [...document.querySelectorAll<HTMLElement>('.moments-result')]
const primary = (index: number) => rows()[index]!.querySelector<HTMLButtonElement>('.moments-card-primary')!
const openDetail = () => screen.queryByRole('region', { name: /^Selected moment: / })

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = vi.fn()
  // No test here may touch a network: every transport fails fast.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network disabled in tests') }))
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockReturnValue(new Promise(() => {}))
  vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue(null)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearRankedFeatureCheckForTests()
  stepBack.mode = 'real'
  stepBack.held.length = 0
  window.getSelection()?.removeAllRanges()
})

describe('moments open in line', () => {
  it('opens under the clicked row without changing the list layout', async () => {
    renderMoments()
    expect(primary(0).getAttribute('aria-expanded')).toBe('false')
    // Nothing is open, so no row points at the detail slot.
    expect(rows().map((_, index) => primary(index).hasAttribute('aria-controls'))).toEqual([false, false])
    expect(primary(0).getAttribute('aria-label')).toBe('Chat spike — Open moment for xqc at 1:00 into broadcast')
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    expect(rows()[0]!.nextElementSibling?.id).toBe('moments-selected-detail')
    // Pressed again, the open row closes its moment: its name says so, with aria-expanded.
    expect(primary(0).getAttribute('aria-label')).toBe('Chat spike — Close moment for xqc at 1:00 into broadcast')
    expect(primary(1).getAttribute('aria-label')).toBe('Emote spike — Open moment for sodapoppin at 4:00 into broadcast')
    // In line it has no heading, so the region itself is named for its moment.
    expect(openDetail()!.getAttribute('aria-label')).toBe('Selected moment: Chat spike, xqc, 1:00 into broadcast')
    expect(rows()[0]!.nextElementSibling?.contains(openDetail())).toBe(true)
    expect(primary(0).getAttribute('aria-expanded')).toBe('true')
    expect(primary(0).getAttribute('aria-controls')).toBe('moments-selected-detail')
    expect(primary(1).getAttribute('aria-expanded')).toBe('false')
    // Only the open row controls the one detail slot; a closed row claims nothing.
    expect(primary(1).hasAttribute('aria-controls')).toBe(false)
    expect(document.querySelectorAll('[aria-controls="moments-selected-detail"]')).toHaveLength(1)
    expect(document.querySelector('.moments-layout')!.className).toBe('moments-layout')
    expect(document.querySelector('.moments-workspace')!.className).toBe('moments-workspace')
    expect(screen.getByRole('searchbox', { name: 'Find loaded moments' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Latest', 'Saved (0)'])
    expect(currentUrl).toContain('login=xqc&stream=s1&offset=60')
    const detail = openDetail()!
    expect(detail.querySelector('.moments-detail-head')!.textContent).toContain('1 of 2 loaded moments')
    expect(detail.querySelector('h2, .moments-identity, time')).toBeNull()
    expect(screen.queryByRole('button', { name: /Back to results/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Previous moment' }).hasAttribute('disabled')).toBe(true)
    expect(minuteWindow.loadMomentMinuteWindow).toHaveBeenCalledTimes(1)
  })

  it('closes on a click away, but not on the open row’s own controls', async () => {
    renderMoments()
    const listKey = currentKey
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    // Save on the open row keeps it open.
    fireEvent.click(rows()[0]!.querySelector('.moments-actions button')!)
    expect(openDetail()).not.toBeNull()
    // Inside the detail stays open.
    fireEvent.pointerDown(openDetail()!)
    fireEvent.click(openDetail()!)
    expect(openDetail()).not.toBeNull()
    // The page heading is away.
    fireEvent.pointerDown(screen.getByRole('heading', { level: 1 }))
    fireEvent.click(screen.getByRole('heading', { level: 1 }))
    await waitFor(() => expect(openDetail()).toBeNull())
    await waitFor(() => expect(currentUrl).toBe('/analytics/moments'))
    expect(primary(0).getAttribute('aria-expanded')).toBe('false')
    // Once closed, no row points at the detail slot any more.
    expect(rows().map((_, index) => primary(index).hasAttribute('aria-controls'))).toEqual([false, false])
    // Closing a selection opened here stepped back to the list's own entry instead of
    // replacing the selection's entry, so browser Back never reopens it.
    expect(currentKey).toBe(listKey)
    // Focus stays where the reader clicked.
    expect(document.activeElement).not.toBe(primary(0))
  })

  it('returns focus to the row on browser Back after an earlier click away', async () => {
    renderMoments()
    const heading = screen.getByRole('heading', { level: 1 })
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    fireEvent.pointerDown(heading)
    fireEvent.click(heading)
    await waitFor(() => expect(openDetail()).toBeNull())
    // The click away left focus alone; the next close is browser Back from inside a detail.
    fireEvent.click(primary(1))
    await waitFor(() => expect(rows()[1]!.nextElementSibling?.id).toBe('moments-selected-detail'))
    act(() => screen.getByRole('button', { name: 'Close' }).focus())
    act(() => historyBack())
    await waitFor(() => expect(currentUrl).toBe('/analytics/moments'))
    await waitFor(() => expect(document.activeElement).toBe(primary(1)))
  })

  it('stays open after a press that started inside it ends outside it, with nothing selected', async () => {
    renderMoments()
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    // Pressed on Close, released in the page: the click lands on an ancestor outside the slot.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Close' }))
    expect(window.getSelection()?.toString()).toBe('')
    fireEvent.click(document.querySelector('.moments-workspace')!)
    await act(() => new Promise(resolve => setTimeout(resolve, 60)))
    expect(openDetail()).not.toBeNull()
    expect(currentUrl).toContain('login=xqc&stream=s1&offset=60')
    // The same click with the press outside is a click away.
    fireEvent.pointerDown(document.querySelector('.moments-workspace')!)
    fireEvent.click(document.querySelector('.moments-workspace')!)
    await waitFor(() => expect(openDetail()).toBeNull())
  })

  it('stays open while text outside it is being selected', async () => {
    renderMoments()
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    const heading = screen.getByRole('heading', { level: 1 })
    // A drag across the page heading to copy it: pressed and released outside the slot.
    fireEvent.pointerDown(heading)
    window.getSelection()!.selectAllChildren(heading)
    expect(window.getSelection()!.toString()).not.toBe('')
    fireEvent.click(heading)
    await act(() => new Promise(resolve => setTimeout(resolve, 60)))
    expect(openDetail()).not.toBeNull()
    // Once nothing is selected, the same click closes it.
    window.getSelection()!.removeAllRanges()
    fireEvent.pointerDown(heading)
    fireEvent.click(heading)
    await waitFor(() => expect(openDetail()).toBeNull())
  })

  it('closes when the open row is pressed again, and Esc returns focus to its button', async () => {
    renderMoments()
    fireEvent.click(rows()[1]!.querySelector('.moments-result-evidence')!)
    await waitFor(() => expect(openDetail()).not.toBeNull())
    expect(rows()[1]!.nextElementSibling?.id).toBe('moments-selected-detail')
    fireEvent.click(rows()[1]!.querySelector('.moments-result-evidence')!)
    await waitFor(() => expect(openDetail()).toBeNull())
    expect(primary(1).getAttribute('aria-label')).toBe('Emote spike — Open moment for sodapoppin at 4:00 into broadcast')
    fireEvent.click(primary(1))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(openDetail()).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(primary(1)))
  })

  it('ignores Esc in a field, and a filter change closes the open moment', async () => {
    renderMoments()
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    const search = screen.getByRole('searchbox', { name: 'Find loaded moments' })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(openDetail()).not.toBeNull()
    act(() => search.focus())
    fireEvent.change(search, { target: { value: 'soda' } })
    await waitFor(() => expect(openDetail()).toBeNull())
    expect(currentUrl).toBe('/analytics/moments?q=soda')
    expect(rows()).toHaveLength(1)
    expect(document.activeElement).toBe(search)
  })

  it('switches rows with one detail open at a time, and Next moves it in line', async () => {
    renderMoments()
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    fireEvent.click(primary(1))
    await waitFor(() => expect(rows()[1]!.nextElementSibling?.id).toBe('moments-selected-detail'))
    expect(screen.getAllByRole('region', { name: /^Selected moment: / })).toHaveLength(1)
    expect(primary(0).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Previous moment' }))
    await waitFor(() => expect(currentUrl).toContain('login=xqc&stream=s1&offset=60'))
    // Previous/Next swap at once: no collapsing copy is left behind.
    expect(document.querySelectorAll('.moments-inline')).toHaveLength(1)
    expect(rows()[0]!.nextElementSibling?.id).toBe('moments-selected-detail')
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Next moment'))
  })

  it('opens a deep link under its row and scrolls that row into view', async () => {
    // Record each class the slot is committed with once it is in the document.
    const seen: MutationRecord[] = []
    const classes = new MutationObserver(records => { seen.push(...records) })
    classes.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true })
    renderMoments('/analytics/moments?login=sodapoppin&stream=s2&offset=240')
    await waitFor(() => expect(openDetail()).not.toBeNull())
    expect(rows()[1]!.nextElementSibling?.id).toBe('moments-selected-detail')
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' }))
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(rows()[1])
    expect(document.activeElement).toBe(primary(1))
    // Already open: it does not replay the opening (it never sat collapsed in the document).
    expect(document.querySelector('.moments-inline')!.className).toContain('is-open')
    seen.push(...classes.takeRecords())
    classes.disconnect()
    const replays = seen.filter(record => (record.target as Element).classList.contains('moments-inline') && !record.oldValue?.includes('is-open'))
    expect(replays).toHaveLength(0)
  })

  it('keeps a standalone card in place while a failing feed polls with no data', async () => {
    const saved = { data: hub.data, loading: hub.loading, error: hub.error }
    try {
      Object.assign(hub, { data: undefined, loading: false, error: 'Moments could not be refreshed' })
      const view = renderMoments('/analytics/moments?login=forsen&stream=s9&offset=600')
      await waitFor(() => expect(openDetail()).not.toBeNull())
      // The next poll reports loading again; the card must not collapse and reopen.
      Object.assign(hub, { loading: true })
      view.rerender(<MemoryRouter initialEntries={['/analytics/moments?login=forsen&stream=s9&offset=600']}><AnalyticsMomentsPage /><UrlProbe /></MemoryRouter>)
      expect(document.querySelector('.moments-inline')!.className).toContain('is-open')
      expect(document.querySelector('.moments-inline.is-closing')).toBeNull()
      // The loading state that returns with each poll renders below the card, never above it.
      const card = document.getElementById('moments-selected-detail')!
      expect(card.compareDocumentPosition(document.querySelector('.moments-loading')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    } finally {
      Object.assign(hub, saved)
    }
  })

  it('shows a deep link outside the loaded list as a standalone card at the top', async () => {
    renderMoments('/analytics/moments?login=forsen&stream=s9&offset=600')
    await waitFor(() => expect(openDetail()).not.toBeNull())
    // It leads the results, ahead of the list and any loading or empty state.
    const card = document.getElementById('moments-selected-detail')!
    expect(card.className).toContain('moments-inline--standalone')
    expect(card.parentElement?.className).toBe('moments-results')
    expect(card.compareDocumentPosition(document.querySelector('.moments-result-list')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card.previousElementSibling?.getAttribute('role')).toBe('status')
    const detail = openDetail()!
    expect(detail.textContent).toContain('Selection outside loaded matches')
    expect(detail.querySelector('.moments-identity')).not.toBeNull()
    expect(detail.querySelector('h2')!.textContent).toBe('Selected reaction')
    await waitFor(() => expect(document.activeElement).toBe(detail.querySelector('h2')))
    expect(rows()).toHaveLength(2)
    expect(rows().every(row => row.querySelector('.moments-card-primary')!.getAttribute('aria-expanded') === 'false')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(openDetail()).toBeNull())
    expect(currentUrl).toBe('/analytics/moments')
  })
})

describe('a row that does not open in line', () => {
  it('keeps naming its press as opening the moment while it is the selected one', () => {
    // A broadcast's rows select into a separate review; pressing the selected one does not close it.
    render(<MemoryRouter><MomentRow moment={fromHubMoment(row('xqc', 's1', 60, 'Chat spike', 'Just Chatting', 0))!} selected onSelect={() => {}} /></MemoryRouter>)
    const button = document.querySelector('.moments-card-primary')!
    expect(button.getAttribute('aria-label')).toBe('Chat spike — Open moment for xqc at 1:00 into broadcast')
    expect(button.hasAttribute('aria-expanded')).toBe(false)
    expect(button.getAttribute('aria-current')).toBe('true')
  })
})

describe('the open moment stays where it opened', () => {
  const original = { ...hub }
  const key = (element: Element) => element.querySelector('[data-discovery-key]')!.getAttribute('data-discovery-key')
  const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 60)))
  /** The saved store is module state; empty it so each test starts from its own saves. */
  function resetSaved() {
    localStorage.clear()
    const probe = fromHubMoment(row('probe', 'p0', 1, 'Probe', 'Probe', 0))!
    for (const item of [probe, probe]) toggleSavedMoment(item)
  }
  function save(...moments: ReturnType<typeof row>[]) {
    for (const moment of moments) toggleSavedMoment(fromHubMoment(moment)!)
  }
  beforeEach(() => resetSaved())
  afterEach(() => { Object.assign(hub, original); resetSaved() })

  it('keeps the open moment, its row and focus in place when it is un-saved in Saved', async () => {
    save(row('xqc', 's1', 60, 'Chat spike', 'Just Chatting', 0), row('sodapoppin', 's2', 240, 'Emote spike', 'Minecraft', 5), row('forsen', 's3', 480, 'Laugh spike', 'Just Chatting', 10))
    renderMoments('/analytics/moments?view=saved')
    await waitFor(() => expect(rows()).toHaveLength(3))
    fireEvent.click(primary(2))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    const slot = document.getElementById('moments-selected-detail')!
    const detail = openDetail()!
    const toggle = within(detail).getByRole('button', { name: 'Saved' })
    act(() => toggle.focus())
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Saved (2)' })).toBeTruthy())
    await settle()
    // The row stays listed with the same detail under it: not moved, not remounted.
    expect(rows().map(key)).toEqual(['["xqc","s1",60]', '["sodapoppin","s2",240]', '["forsen","s3",480]'])
    expect(document.getElementById('moments-selected-detail')).toBe(slot)
    expect(openDetail()).toBe(detail)
    expect(rows()[2]!.nextElementSibling).toBe(slot)
    expect(slot.className).not.toContain('moments-inline--standalone')
    expect(document.activeElement).toBe(toggle)
    expect(toggle.textContent).toBe('Save')
    expect(detail.querySelector('.moments-detail-head')!.textContent).toContain('3 of 3 loaded moments')
    expect(minuteWindow.loadMomentMinuteWindow).toHaveBeenCalledTimes(1)
    // The row's own toggle is the same moment: saving it again keeps the same detail.
    fireEvent.click(within(rows()[2]!).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Saved (3)' })).toBeTruthy())
    expect(openDetail()).toBe(detail)
    // Once closed, the list shows only what is saved.
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Saved (2)' })).toBeTruthy())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(openDetail()).toBeNull())
    expect(rows()).toHaveLength(2)
  })

  it('keeps the measurements a deep-linked saved moment showed after it is un-saved', async () => {
    save(row('xqc', 's1', 60, 'Chat spike', 'Just Chatting', 0))
    renderMoments('/analytics/moments?view=saved&login=xqc&stream=s1&offset=60')
    await waitFor(() => expect(openDetail()).not.toBeNull())
    const detail = openDetail()!
    expect(detail.querySelector('.moments-measurement dd')!.textContent).toBe('200')
    fireEvent.click(within(detail).getByRole('button', { name: 'Saved' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Saved (0)' })).toBeTruthy())
    expect(openDetail()).toBe(detail)
    expect(detail.querySelector('.moments-measurement dd')!.textContent).toBe('200')
    expect(rows()).toHaveLength(1)
    expect(screen.queryByText('Keep reactions worth returning to')).toBeNull()
  })

  it('keeps a standalone card in place when its moment is saved into the open list', async () => {
    save(row('xqc', 's1', 60, 'Chat spike', 'Just Chatting', 0))
    renderMoments('/analytics/moments?view=saved&login=sodapoppin&stream=s2&offset=240')
    await waitFor(() => expect(openDetail()).not.toBeNull())
    const card = document.getElementById('moments-selected-detail')!
    expect(card.className).toContain('moments-inline--standalone')
    const detail = openDetail()!
    fireEvent.click(within(detail).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rows()).toHaveLength(2))
    await settle()
    expect(document.getElementById('moments-selected-detail')).toBe(card)
    expect(openDetail()).toBe(detail)
    expect(card.inert).toBe(false)
    expect(document.querySelectorAll('.moments-inline')).toHaveLength(1)
    // The newly listed row stands for the open card, and pressing it closes the card.
    const listed = rows().find(element => key(element) === '["sodapoppin","s2",240]')!
    const button = listed.querySelector('.moments-card-primary')!
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBe('moments-selected-detail')
    fireEvent.click(button)
    await waitFor(() => expect(openDetail()).toBeNull())
    expect(currentUrl).toBe('/analytics/moments?view=saved')
  })

  it('keeps a standalone card in place when a late feed lists its row', async () => {
    Object.assign(hub, { data: { generatedAt: new Date().toISOString(), livePulseMoments: [] } })
    const view = renderMoments('/analytics/moments?login=sodapoppin&stream=s2&offset=240')
    await waitFor(() => expect(openDetail()).not.toBeNull())
    const card = document.getElementById('moments-selected-detail')!
    const detail = openDetail()!
    await waitFor(() => expect(document.activeElement).toBe(detail.querySelector('h2')))
    Object.assign(hub, { data: original.data })
    view.rerender(tree('/analytics/moments?login=sodapoppin&stream=s2&offset=240'))
    await waitFor(() => expect(rows()).toHaveLength(2))
    await settle()
    expect(document.getElementById('moments-selected-detail')).toBe(card)
    expect(openDetail()).toBe(detail)
    expect(document.activeElement).toBe(detail.querySelector('h2'))
    expect(primary(1).getAttribute('aria-expanded')).toBe('true')
    expect(minuteWindow.loadMomentMinuteWindow).toHaveBeenCalledTimes(1)
  })

  it('moves a cached row the live feed dropped to a standalone card, in view and focused', async () => {
    Object.assign(hub, { loadSource: 'cache' })
    const view = renderMoments('/analytics/moments?login=xqc&stream=s1&offset=60')
    await waitFor(() => expect(rows()[0]!.nextElementSibling?.id).toBe('moments-selected-detail'))
    vi.mocked(Element.prototype.scrollIntoView).mockClear()
    // The network answer replaces the cached snapshot and no longer has the open row.
    Object.assign(hub, { loadSource: 'network', data: { generatedAt: new Date().toISOString(), livePulseMoments: [original.data.livePulseMoments[1]!] } })
    view.rerender(tree('/analytics/moments?login=xqc&stream=s1&offset=60'))
    await waitFor(() => expect(rows()).toHaveLength(1))
    const card = document.getElementById('moments-selected-detail')!
    expect(card.className).toContain('moments-inline--standalone')
    // A cached row was never a live collection: it is not kept listed.
    expect(rows().map(key)).toEqual(['["sodapoppin","s2",240]'])
    expect(openDetail()!.textContent).toContain('Selection outside loaded matches')
    await waitFor(() => expect(document.activeElement).toBe(openDetail()!.querySelector('h2')))
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(card)
  })

  it('keeps focus on the Previous or Next control just used while both still move', async () => {
    Object.assign(hub, { data: { generatedAt: new Date().toISOString(), livePulseMoments: [...original.data.livePulseMoments, row('forsen', 's3', 480, 'Laugh spike', 'Just Chatting', 10)] } })
    renderMoments()
    await waitFor(() => expect(rows()).toHaveLength(3))
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    const head = () => openDetail()!.querySelector('.moments-detail-head')!.textContent
    const focused = () => document.activeElement?.getAttribute('aria-label')
    const announcement = document.querySelector('[data-review-announcement]')!
    expect(announcement.getAttribute('aria-live')).toBe('polite')
    expect(announcement.textContent).toBe('')
    const press = (name: 'Previous moment' | 'Next moment') => {
      const control = screen.getByRole('button', { name })
      act(() => control.focus())
      fireEvent.click(control)
    }
    press('Next moment')
    await waitFor(() => expect(rows()[1]!.nextElementSibling?.id).toBe('moments-selected-detail'))
    expect(head()).toContain('2 of 3 loaded moments')
    await waitFor(() => expect(focused()).toBe('Next moment'))
    // Focus stays on Next, so the moment it opened is announced, from outside the swapped slot.
    expect(announcement.textContent).toBe('Moment 2 of 3: Emote spike, sodapoppin, 4:00 into broadcast')
    expect(openDetail()!.getAttribute('aria-label')).toBe('Selected moment: Emote spike, sodapoppin, 4:00 into broadcast')
    expect(document.getElementById('moments-selected-detail')!.contains(announcement)).toBe(false)
    press('Next moment')
    await waitFor(() => expect(rows()[2]!.nextElementSibling?.id).toBe('moments-selected-detail'))
    expect(head()).toContain('3 of 3 loaded moments')
    expect(document.querySelector('[data-review-announcement]')).toBe(announcement)
    expect(announcement.textContent).toBe('Moment 3 of 3: Laugh spike, forsen, 8:00 into broadcast')
    // At the end of the list, the control that still moves.
    await waitFor(() => expect(focused()).toBe('Previous moment'))
    press('Previous moment')
    await waitFor(() => expect(rows()[1]!.nextElementSibling?.id).toBe('moments-selected-detail'))
    expect(head()).toContain('2 of 3 loaded moments')
    await waitFor(() => expect(focused()).toBe('Previous moment'))
    expect(currentUrl).toContain('login=sodapoppin&stream=s2&offset=240')
    expect(announcement.textContent).toBe('Moment 2 of 3: Emote spike, sodapoppin, 4:00 into broadcast')
    // A row press is announced by the row's own button; nothing is left to read out here.
    fireEvent.click(primary(0))
    await waitFor(() => expect(rows()[0]!.nextElementSibling?.id).toBe('moments-selected-detail'))
    expect(announcement.textContent).toBe('')
    press('Next moment')
    await waitFor(() => expect(announcement.textContent).toBe('Moment 2 of 3: Emote spike, sodapoppin, 4:00 into broadcast'))
    // Closed, the announcement goes with it, and reopening that row does not repeat it.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(openDetail()).toBeNull())
    expect(announcement.textContent).toBe('')
    fireEvent.click(primary(1))
    await waitFor(() => expect(rows()[1]!.nextElementSibling?.id).toBe('moments-selected-detail'))
    expect(announcement.textContent).toBe('')
  })

  it('keeps the open moment while Save is pressed on another row', async () => {
    renderMoments()
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    const detail = openDetail()!
    const other = within(rows()[1]!).getByRole('button', { name: 'Save' })
    fireEvent.pointerDown(other)
    fireEvent.click(other)
    expect(other.textContent).toBe('Saved')
    await settle()
    expect(openDetail()).toBe(detail)
    expect(currentUrl).toContain('login=xqc&stream=s1&offset=60')
  })

  it('keeps the open moment while new moments are shown or a failed feed is retried', async () => {
    Object.assign(hub, { error: 'Moments could not be refreshed', refresh: vi.fn() })
    const view = renderMoments()
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    const detail = openDetail()!
    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.pointerDown(retry)
    fireEvent.click(retry)
    expect(hub.refresh).toHaveBeenCalledTimes(1)
    await settle()
    expect(openDetail()).toBe(detail)
    // A poll during the review queues its new moment behind a button.
    Object.assign(hub, { error: null, data: { generatedAt: new Date().toISOString(), livePulseMoments: [...original.data.livePulseMoments, row('forsen', 's3', 30, 'New spike', 'Just Chatting', 20)] } })
    view.rerender(tree(currentUrl))
    const more = await screen.findByRole('button', { name: 'Show 1 new moment' })
    fireEvent.pointerDown(more)
    fireEvent.click(more)
    await waitFor(() => expect(rows()).toHaveLength(3))
    await settle()
    expect(openDetail()).toBe(detail)
    expect(currentUrl).toContain('login=xqc&stream=s1&offset=60')
    expect(rows().map(key)).toContain('["forsen","s3",30]')
  })

  it('leaves focus on the tab when a tab switch closes the open moment', async () => {
    save(row('xqc', 's1', 60, 'Chat spike', 'Just Chatting', 0))
    renderMoments()
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    const latest = screen.getByRole('tab', { name: 'Latest' })
    act(() => latest.focus())
    fireEvent.keyDown(latest, { key: 'ArrowRight' })
    await waitFor(() => expect(currentUrl).toBe('/analytics/moments?view=saved'))
    await waitFor(() => expect(openDetail()).toBeNull())
    await settle()
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Saved (1)' }))
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    // Arrow keys keep moving through the tabs.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    await waitFor(() => expect(currentUrl).toBe('/analytics/moments?view=recent'))
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Latest' }))
  })

  it('steps back to the list when two rows were pressed before the first opened', async () => {
    renderMoments()
    act(() => {
      fireEvent.click(primary(0))
      fireEvent.click(primary(1))
    })
    await waitFor(() => expect(currentUrl).toContain('login=sodapoppin&stream=s2&offset=240'))
    await waitFor(() => expect(rows()[1]!.nextElementSibling?.id).toBe('moments-selected-detail'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(openDetail()).toBeNull())
    expect(currentUrl).toBe('/analytics/moments')
    await act(() => new Promise(resolve => setTimeout(resolve, 1200)))
    expect(openDetail()).toBeNull()
    expect(currentUrl).toBe('/analytics/moments')
  })
})

describe('changes made while a close is stepping back', () => {
  it('opens the next row only after the step back lands, with the list still behind it', async () => {
    stepBack.mode = 'hold'
    renderMoments()
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(primary(1))
    // The step back is still in flight: the press waits instead of editing the closing entry.
    expect(stepBack.held).toHaveLength(1)
    expect(currentUrl).toContain('login=xqc&stream=s1&offset=60')
    act(() => stepBack.held.shift()!())
    await waitFor(() => expect(currentUrl).toContain('login=sodapoppin&stream=s2&offset=240'))
    await waitFor(() => expect(rows()[1]!.nextElementSibling?.id).toBe('moments-selected-detail'))
    expect(screen.getAllByRole('region', { name: /^Selected moment: / })).toHaveLength(1)
    // It was pushed over the list, so closing it steps back to the list.
    stepBack.mode = 'real'
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(currentUrl).toBe('/analytics/moments'))
    await waitFor(() => expect(openDetail()).toBeNull())
  })

  it('applies a filter typed during the step back to the list it lands on', async () => {
    stepBack.mode = 'hold'
    renderMoments()
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find loaded moments' }), { target: { value: 'soda' } })
    expect(stepBack.held).toHaveLength(1)
    act(() => stepBack.held.shift()!())
    await waitFor(() => expect(currentUrl).toBe('/analytics/moments?q=soda'))
    await waitFor(() => expect(openDetail()).toBeNull())
    expect(rows()).toHaveLength(1)
  })

  it('applies a waiting row press after a second even if the step back never lands', async () => {
    stepBack.mode = 'drop'
    renderMoments()
    fireEvent.click(primary(0))
    await waitFor(() => expect(openDetail()).not.toBeNull())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(primary(1))
    await act(() => new Promise(resolve => setTimeout(resolve, 300)))
    expect(currentUrl).toContain('login=xqc&stream=s1&offset=60')
    await act(() => new Promise(resolve => setTimeout(resolve, 900)))
    expect(currentUrl).toContain('login=sodapoppin&stream=s2&offset=240')
    await waitFor(() => expect(rows()[1]!.nextElementSibling?.id).toBe('moments-selected-detail'))
  })
})

describe('a deep link before its list arrives', () => {
  it('keeps the selection through a click or Esc on the page while nothing is shown yet', async () => {
    const original = { data: hub.data, loading: hub.loading }
    const url = '/analytics/moments?login=sodapoppin&stream=s2&offset=240'
    try {
      Object.assign(hub, { data: undefined, loading: true })
      const view = renderMoments(url)
      expect(openDetail()).toBeNull()
      // The reader clicks the heading and presses Esc while the slow feed loads.
      fireEvent.pointerDown(screen.getByRole('heading', { level: 1 }))
      fireEvent.click(screen.getByRole('heading', { level: 1 }))
      fireEvent.keyDown(document.body, { key: 'Escape' })
      await act(() => new Promise(resolve => setTimeout(resolve, 60)))
      expect(currentUrl).toBe(url)
      Object.assign(hub, original)
      view.rerender(tree(url))
      await waitFor(() => expect(rows()[1]!.nextElementSibling?.id).toBe('moments-selected-detail'))
      // Once on screen, Esc closes it as usual.
      fireEvent.keyDown(document.body, { key: 'Escape' })
      await waitFor(() => expect(openDetail()).toBeNull())
      expect(currentUrl).toBe('/analytics/moments')
    } finally {
      Object.assign(hub, original)
    }
  })
})

describe('returning from the stream timeline', () => {
  const list = '/analytics/moments'
  const xqc = '/analytics/moments?login=xqc&stream=s1&offset=60'
  const soda = '/analytics/moments?login=sodapoppin&stream=s2&offset=240'
  let scrollY = 0
  beforeEach(() => {
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY)
  })
  /** The page remembers each URL's scroll as the reader scrolls it. */
  async function scrolledAt(url: string, y: number) {
    renderMoments(url)
    scrollY = y
    fireEvent.scroll(window)
    cleanup()
    await frames()
  }
  /** The timeline's back link: a new entry for the review, marked as that arrival. */
  const arriveBack = (url: string) => render(<MemoryRouter initialEntries={[{ pathname: list, search: url.slice(list.length), state: { momentsReturn: true } }]}><AnalyticsMomentsPage /><UrlProbe /></MemoryRouter>)
  const frames = () => act(() => new Promise(resolve => setTimeout(resolve, 120)))
  /** Arrived, with the arrival's own restore run: what follows is the reader's. */
  async function settled() {
    await waitFor(() => expect(openDetail()).not.toBeNull())
    await frames()
    vi.mocked(window.scrollTo).mockClear()
  }
  const scrolledTo = (y: number) => vi.mocked(window.scrollTo).mock.calls.some(call => call[0] === 0 && call[1] === y)

  it('leaves the page where the reader is when they close the review it restored', async () => {
    await scrolledAt(list, 500)
    arriveBack(xqc)
    await settled()
    // The reader reads on, then closes the moment.
    scrollY = 1400
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(currentUrl).toBe(list))
    await frames()
    expect(scrolledTo(500)).toBe(false)
  })

  it('leaves Next where it aligned the detail, on a moment visited before', async () => {
    await scrolledAt(soda, 700)
    arriveBack(xqc)
    await settled()
    scrollY = 1400
    fireEvent.click(screen.getByRole('button', { name: 'Next moment' }))
    await waitFor(() => expect(currentUrl).toBe(soda))
    await frames()
    expect(scrolledTo(700)).toBe(false)
  })
})
