/** Text markers that must never survive into a store-target JavaScript bundle. */
export const STORE_DEVELOPER_MARKERS = [
  'settings-backend-url',
  'data-developer-tools',
  'Test & Apply',
  'Developer tools',
]

export function findStoreDeveloperMarkers(contents) {
  const text = String(contents ?? '')
  return STORE_DEVELOPER_MARKERS.filter(marker => text.includes(marker))
}
