/** Small static icons: no font, animation runtime or third-party icon bundle. */
export function LibraryIcon({ name }: { name: 'bookmark' | 'check' | 'preview' | 'play' }) {
  const paths = {
    bookmark: 'M5 3h10v14l-5-3-5 3V3Z',
    check: 'm4 10 4 4 8-8',
    preview: 'M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Zm11 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    play: 'm7 4 9 6-9 6V4Z',
  }
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}
