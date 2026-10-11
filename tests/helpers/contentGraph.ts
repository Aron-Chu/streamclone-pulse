import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Runtime (non-type) relative imports of a source file. */
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g
  for (const match of source.matchAll(statement)) {
    const [, , typeOnly, clause, path] = match
    if (typeOnly) continue
    // `import { type A, type B }` is erased too.
    const names = /^\{([^}]*)\}$/.exec(clause.trim())?.[1].split(',').map(part => part.trim()).filter(Boolean)
    if (names && names.length && names.every(name => name.startsWith('type '))) continue
    found.push(path)
  }
  for (const match of source.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) found.push(match[1])
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/g)) found.push(match[1])
  return found.map(path => resolve(dirname(file), path))
}

/**
 * Every source module the Twitch content script reaches at run time, as
 * repo-relative POSIX paths, walked from `src/content/entry.ts`.
 *
 * Unit tests run before `npm run build` in CI, so a check on
 * `dist/content/twitch.js` alone never runs there. This source-level walk does:
 * if a module is not in this graph, the bundler cannot put it in twitch.js.
 */
export function contentScriptModules(): string[] {
  const seen = new Set<string>()
  const queue = [resolve(root, 'src/content/entry.ts')]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const target of runtimeImports(file)) {
      const candidates = [target, `${target}.ts`, `${target}.tsx`, resolve(target, 'index.ts')]
      const hit = candidates.find(candidate => existsSync(candidate) && !candidate.endsWith('/') && /\.(ts|tsx)$/.test(candidate))
      if (hit && !seen.has(hit)) queue.push(hit)
    }
  }
  return [...seen].map(file => file.slice(root.length + 1).replaceAll('\\', '/')).sort()
}
