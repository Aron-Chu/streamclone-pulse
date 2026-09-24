import { createRoot } from 'react-dom/client'
import { installedExtensionVersion } from '../shared/releaseManifest.ts'
import { getThemePreference } from '../shared/storage.ts'
import { applyAccentTheme } from '../ui/overlayTheme.ts'
import { SettingsWorkspace } from '../ui/SettingsWorkspace.tsx'
import { injectStyles } from '../ui/theme.ts'
import { DeveloperTools } from './DeveloperTools.tsx'
import { injectHostStyles } from './hostStyles.ts'
import { DEFAULT_NAV, SettingsHostShell } from './SettingsHostShell.tsx'
import { MyMomentsPage } from './MyMomentsPage.tsx'

// Shared control styles first, then the page shell so host rules win on ties.
injectStyles()
injectHostStyles()
void getThemePreference().then(applyAccentTheme)

const DEV_NAV = [
  ...DEFAULT_NAV,
  { id: 'developer', label: 'Developer' },
] as const

createRoot(document.getElementById('root')!).render(
  <SettingsHostShell version={installedExtensionVersion()} navItems={DEV_NAV}>
    {activeSection => activeSection === 'moments' ? <MyMomentsPage /> : <SettingsWorkspace activeSection={activeSection} developerTools={<DeveloperTools />} />}
  </SettingsHostShell>,
)
