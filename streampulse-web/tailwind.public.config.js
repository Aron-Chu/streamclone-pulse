/** Public utility pages must work before the lazy analytics CSS loads. */
export default {
  content: ['./src/routes/public/**/*.{ts,tsx}', './src/ui/components/PublicLayout.tsx'],
  important: '.app-shell',
  theme: { extend: { fontFamily: { mono: ['Geist Mono Variable', 'monospace'] } } },
  corePlugins: { preflight: false },
}
