export function resolveViteArgs(argv) {
  const args = argv.filter(arg => arg !== '--watch-config' && arg !== '--no-watch-config')
  const lanIndex = args.indexOf('--lan')
  if (lanIndex !== -1) {
    args.splice(lanIndex, 1, '--host', '0.0.0.0')
  }
  if (args.length === 0) args.push('--host', '127.0.0.1', '--port', '5173')
  if (!args.includes('--strictPort')) args.push('--strictPort')
  return args
}
