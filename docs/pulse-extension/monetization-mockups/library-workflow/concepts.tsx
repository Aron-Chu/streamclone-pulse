import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsHostShell } from '../../../../src/options/SettingsHostShell.tsx'
import { injectHostStyles } from '../../../../src/options/hostStyles.ts'
import { applyAccentTheme } from '../../../../src/ui/overlayTheme.ts'
import { MomentStats, MomentEmotes } from '../../../../src/ui/library/MomentStats.tsx'
import { MomentPreview } from '../../../../src/ui/library/MomentPreview.tsx'
import { LibraryIcon } from '../../../../src/ui/library/LibraryIcon.tsx'
import { timestamp, type LibraryMoment } from '../../../../src/ui/library/model.ts'
import { createDemoSnapshot } from './demoRepository.ts'
import { demoContexts, demoPresentations } from './demoContexts.ts'
import '../../../../src/ui/library/library.css'
import './concepts.css'

const seed = createDemoSnapshot('design').moments.slice(0, 3)
const nav = [{ id: 'pulse' as const, label: 'Library' }]
function Concepts() {
  const [direction, setDirection] = useState<'inspector' | 'shelf'>('inspector')
  const [view, setView] = useState<'saved' | 'history'>('saved')
  const [items, setItems] = useState(seed)
  const [selectedId, setSelectedId] = useState('two')
  const [modalId, setModalId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const selected = items.find(m => m.id === selectedId) ?? items[0]
  const shown = items.filter(m => view === 'saved' ? m.savedAt !== undefined : m.jumpedAt !== undefined).filter(m => `${m.channel} ${m.title} ${m.note}`.toLowerCase().includes(query.toLowerCase()))
  const context = demoContexts[selected.id]
  const detail = context?.kind === 'ready' ? context.value : null
  const modal = items.find(m => m.id === modalId)
  function bookmark(moment: LibraryMoment) {
    setItems(previous => previous.map(m => m.id === moment.id ? {...m, savedAt: Date.now()} : m))
    setNotice('Bookmarked in this concept. No real extension data changed.')
  }
  return <>
    <div className="lc-chooser"><div><strong>Two Library directions</strong><span>Design only · illustrative data · no payment or storage changes</span></div>
      <div role="group" aria-label="Design direction"><button aria-pressed={direction === 'inspector'} onClick={() => setDirection('inspector')}>A · Inspector</button><button aria-pressed={direction === 'shelf'} onClick={() => setDirection('shelf')}>B · Shelf</button></div>
      <label>Accent <select aria-label="Concept accent" onChange={e => applyAccentTheme(e.target.value as 'aurora' | 'volt' | 'azure')}><option value="aurora">Aurora</option><option value="volt">Volt</option><option value="azure">Azure</option></select></label>
      <a href="./#pulse">Previous mockup ↗</a>
    </div>
    <SettingsHostShell navItems={nav} version="concept"><main id="settings-content" className="pl-library lc-library" tabIndex={-1}>
      <header className="lc-heading"><div><span className="pl-eyebrow">YOUR MOMENTS</span><h2>Library</h2><p className="pl-muted">{direction === 'inspector' ? 'A quiet list. The selected moment stays in view.' : 'A visual shelf. Open a moment when you want the detail.'}</p></div><span className="pl-tag">Pulse Supporter · preview</span></header>
      <div className="lc-toolbar"><nav className="lc-tabs" aria-label="Library view"><button aria-current={view === 'saved' ? 'page' : undefined} onClick={() => setView('saved')}>Bookmarks</button><button aria-current={view === 'history' ? 'page' : undefined} onClick={() => setView('history')}>History</button></nav>
        <input type="search" aria-label="Search Library" placeholder="Search channel, moment, note…" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="lc-meta"><span>{shown.length} {shown.length === 1 ? 'moment' : 'moments'} · On this device</span><span>References, not downloaded videos</span></div>
      <div className={`lc-workspace lc-${direction}`}>
        <section aria-label={view === 'saved' ? 'Bookmarks' : 'History'} className="lc-results">
          {shown.length ? shown.map(moment => {
            const stats = demoContexts[moment.id]
            const data = stats?.kind === 'ready' ? stats.value : null
            return <article className={`lc-item ${direction === 'inspector' && selectedId === moment.id ? 'lc-selected' : ''}`} key={moment.id}>
              {direction === 'shelf' ? <div className="lc-frame"><span className="lc-frame-channel">{moment.channel}</span><span className="lc-frame-note"><LibraryIcon name="preview" />Historical frame not supplied</span><time>{timestamp(moment.offsetSeconds)}</time></div> : null}
              <div className="lc-item-content"><div className="lc-item-meta"><span>{moment.channel} · {demoPresentations[moment.id]?.gameAtMoment}</span>{direction === 'inspector' ? <time>{timestamp(moment.offsetSeconds)}</time> : null}</div>
                <button className="lc-title" onClick={() => { setSelectedId(moment.id); if(direction === 'shelf') setModalId(moment.id) }}>{moment.title}<span aria-hidden="true">↗</span></button>
                {moment.note ? <p className="lc-note">{moment.note}</p> : null}
                {data ? <dl className="lc-inline-stats"><div><dt>Viewers</dt><dd>{data.selectedViewers?.toLocaleString() ?? '—'}</dd></div><div><dt>Chat/min</dt><dd>{data.selectedMessages?.toLocaleString() ?? '—'}</dd></div><div><dt>Emotes/min</dt><dd>{data.selectedEmotes?.toLocaleString() ?? '—'}</dd></div></dl> : <p className="pl-muted">No saved measurements</p>}
                <footer className="lc-item-footer"><span>{moment.savedAt !== undefined ? 'Bookmarked' : 'History only'} · {data ? 'Example stats' : 'Source unavailable'}</span><button className="lc-link" onClick={() => { setSelectedId(moment.id); setModalId(moment.id) }}>Inspect →</button></footer>
              </div>
            </article>
          }) : <div className="pl-empty"><h3>No matching moments</h3><p>Try another channel or a word from your note.</p><button className="pl-button" onClick={() => setQuery('')}>Clear search</button></div>}
        </section>
        {direction === 'inspector' ? <aside className="lc-inspection" aria-label="Selected moment"><div className="lc-inspection-header"><span className="pl-eyebrow">SELECTED MOMENT</span><time>{timestamp(selected.offsetSeconds)}</time></div><h3>{selected.title}</h3><p className="pl-muted">{selected.channel} · {demoPresentations[selected.id]?.gameAtMoment}</p>
          {demoPresentations[selected.id]?.signal ? <p className="lc-signal">{demoPresentations[selected.id].signal?.label}<span>Illustrative comparison</span></p> : null}
          {detail ? <><MomentStats context={detail} /><MomentEmotes context={detail} compact /></> : <p className="pl-muted">Measurements unavailable. Your reference remains saved.</p>}
          <div className="lc-inspection-actions"><button className="pl-button pl-primary" onClick={() => setModalId(selected.id)}>Open moment preview</button><button className="pl-button" disabled={selected.savedAt !== undefined} onClick={() => bookmark(selected)}>{selected.savedAt !== undefined ? 'Bookmarked' : 'Bookmark'}</button></div>
          <p className="pl-muted">No replay frame is supplied in these concepts. No current live thumbnail is used as a historical frame.</p>
        </aside> : null}
      </div>
      <p className="lc-notice" role="status">{notice}</p>
      <p className="lc-concept-note">{direction === 'inspector' ? 'A · Familiar, compact navigation. Select a row to compare its stats and emote mix without leaving the list.' : 'B · More room for historical thumbnails when available. Stats remain visible; full analysis opens on demand.'}</p>
      {modal ? <MomentPreview moment={modal} context={demoContexts[modal.id]} presentation={demoPresentations[modal.id]} busy={false} error={null} onClose={() => setModalId(null)} onSave={() => bookmark(modal)} onOpenLink={() => setNotice('Replay link opened. This does not record a confirmed watch.')} /> : null}
    </main></SettingsHostShell>
  </>
}
injectHostStyles(); applyAccentTheme('aurora')
createRoot(document.getElementById('root')!).render(<Concepts />)
