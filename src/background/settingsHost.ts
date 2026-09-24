import type { SettingsHostSection } from '../shared/messages.ts'

export type { SettingsHostSection } from '../shared/messages.ts'

export interface SettingsHostTabsApi {
  create: (properties: { url: string }) => Promise<unknown>
}

/** Open only the extension-owned settings host; callers cannot supply a URL. */
export async function openSettingsHost(
  tabs: SettingsHostTabsApi,
  getExtensionUrl: (path: string) => string,
  section: SettingsHostSection = 'pulse',
): Promise<void> {
  await tabs.create({ url: `${getExtensionUrl('options/index.html')}#${section}` })
}
