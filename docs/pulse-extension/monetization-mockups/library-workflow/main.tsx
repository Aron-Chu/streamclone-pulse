import { useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SettingsHostShell, type HostNavItem } from '../../../../src/options/SettingsHostShell.tsx'
import { LibraryWorkspace } from '../../../../src/ui/library/LibraryWorkspace.tsx'
import { applyAccentTheme, ACCENT_THEME_OPTIONS } from '../../../../src/ui/overlayTheme.ts'
import { createDemoRepository, demoReference, type DemoScenario } from './demoRepository.ts'
import { injectHostStyles } from '../../../../src/options/hostStyles.ts'
import { demoContexts, demoPresentations } from './demoContexts.ts'
import './preview.css'

const nav: readonly HostNavItem[] = [{ id: 'pulse', label: 'Library' }, { id: 'privacy', label: 'Storage & privacy' }, { id: 'updates', label: 'How saving works' }]
const scenarios: readonly { id: DemoScenario; name: string }[] = [
  { id: 'design', name: 'Populated design · example data' },
  { id: 'ready', name: 'Supporter · local only' }, { id: 'new', name: 'First use · empty' }, { id: 'offline', name: 'Offline · sync pending' },
  { id: 'full', name: 'Storage full' }, { id: 'load-error', name: 'Load failure' }, { id: 'write-error', name: 'Write failure' },
  { id: 'free', name: 'Free member' }, { id: 'expired', name: 'Supporter ended' }, { id: 'large', name: '37 records · pagination' },
]
async function downloadExport(json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'pulse-library-demo.json'; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
function Preview() {
  const [scenario, setScenario] = useState<DemoScenario>('design')
  const [revision, setRevision] = useState(0)
  const repository = useMemo(() => createDemoRepository(scenario), [scenario, revision])
  return <><div className="library-demo-bar">
    <span><strong>Library preview · R3 restored</strong> · Example data · Not live</span>
    <label>Scenario<select aria-label="Preview scenario" value={scenario} onChange={event => setScenario(event.target.value as DemoScenario)}>{scenarios.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    <label>Accent<select aria-label="Preview accent" defaultValue="aurora" onChange={event => applyAccentTheme(event.target.value as 'aurora' | 'volt' | 'azure')}>{ACCENT_THEME_OPTIONS.map(t => <option value={t.value} key={t.value}>{t.label}</option>)}</select></label>
    <button type="button" onClick={() => setRevision(v => v + 1)}>Reset example</button>
  </div><SettingsHostShell navItems={nav} version="preview">{section => <LibraryWorkspace key={`${section}-${scenario}-${revision}`} repository={repository}
    initialView={section === 'privacy' ? 'storage' : section === 'updates' ? 'workflow' : 'saved'} shellNavigation onExport={downloadExport} demoReference={demoReference} contexts={demoContexts} presentations={demoPresentations} />}</SettingsHostShell></>
}
applyAccentTheme('aurora')
injectHostStyles()
const root = document.getElementById('root')
if (root) {
  const reactRoot: Root = import.meta.hot?.data.libraryRoot ?? createRoot(root)
  reactRoot.render(<Preview />)
  if (import.meta.hot) { import.meta.hot.data.libraryRoot = reactRoot; import.meta.hot.accept() }
}
