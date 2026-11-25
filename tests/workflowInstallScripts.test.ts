import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// CI and release builds install dependencies with their install scripts off,
// so a compromised package cannot run code during `npm ci`.

const workflowsDir = fileURLToPath(new URL('../.github/workflows/', import.meta.url))

const workflows = readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => {
    const lines = readFileSync(`${workflowsDir}${name}`, 'utf8')
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('#'))
    return { name, lines }
  })

// npm commands that install packages and run their install scripts unless told not to.
const INSTALLS = new Set(['ci', 'clean-install', 'cit', 'ic', 'install-clean', 'install', 'i', 'in', 'add', 'rebuild'])
// Options before the command that take a value, as in `npm --prefix web ci`.
const VALUE_OPTIONS = new Set(['--prefix', '-C', '--workspace', '-w'])

const bareLongOption = (arg: string | undefined) => arg !== undefined && arg.startsWith('--') && !arg.includes('=')

/**
 * The npm command among the words after `npm`. Any other `--option` may take its value
 * in the next word, as in `npm --cache .npm ci`, so a word right after one counts as
 * that value unless it is an install. That can only read too many words as installs,
 * never too few.
 */
function npmCommand(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!
    if (VALUE_OPTIONS.has(arg)) i += 1
    else if (arg.startsWith('-')) continue
    else if (INSTALLS.has(arg) || !bareLongOption(args[i - 1])) return arg
  }
  return undefined
}

/** Bash drops a backslash-newline before it reads a command, so a continued line joins the next. */
const joinContinued = (lines: string[]) =>
  lines.reduce<string[]>((joined, line) => {
    const last = joined[joined.length - 1]
    if (last !== undefined && last.endsWith('\\')) joined[joined.length - 1] = `${last.slice(0, -1)} ${line.trim()}`
    else joined.push(line)
    return joined
  }, [])

/** Every npm install in the lines, one per shell command: `npm ci && npm ci --ignore-scripts` is two. */
const installCommands = (lines: string[]) =>
  joinContinued(lines).flatMap((line) =>
    line
      .replace(/\s#.*$/, '')
      .split(/&&|\|\||[;|]/)
      .flatMap((part) => {
        // YAML hands `run: "npm ci"` to the shell as npm ci, so a quote around a word is not part of it
        const tokens = part.trim().split(/\s+/).map((token) => token.replace(/^["']+|["']+$/g, ''))
        const npm = tokens.indexOf('npm')
        if (npm < 0) return []
        const command = tokens.slice(npm)
        return INSTALLS.has(npmCommand(command.slice(1)) ?? '') ? [command.join(' ')] : []
      }),
  )

/** The flag's value counts, not its text: `--ignore-scripts=false` runs the scripts. */
const scriptsOff = (command: string) => {
  const tokens = command.split(' ')
  return tokens.some((token, i) =>
    token === '--ignore-scripts=true' || (token === '--ignore-scripts' && tokens[i + 1] !== 'false'),
  )
}

const offenders = (lines: string[]) => installCommands(lines).filter((command) => !scriptsOff(command))

describe('workflow dependency installs', () => {
  it('finds the installs it checks', () => {
    expect(workflows.flatMap(({ lines }) => installCommands(lines)).length).toBeGreaterThanOrEqual(5)
  })

  it('runs every npm install with install scripts off', () => {
    const found = workflows.flatMap(({ name, lines }) => offenders(lines).map((command) => `${name}: ${command}`))
    expect(found).toEqual([])
  })

  it('uses the flag, not the env setting that also skips pre/post hooks', () => {
    for (const { name, lines } of workflows) {
      expect(lines.join('\n'), name).not.toMatch(/npm_config_ignore_scripts/i)
    }
  })
})

describe('the install check itself', () => {
  it('checks chained installs one by one', () => {
    expect(offenders(['run: npm ci && npm ci --ignore-scripts'])).toEqual(['npm ci'])
    expect(offenders(['run: npm ci --ignore-scripts; npm install'])).toEqual(['npm install'])
  })

  it('reads the flag value, not its text', () => {
    expect(offenders(['run: npm ci --ignore-scripts=false'])).toEqual(['npm ci --ignore-scripts=false'])
    expect(offenders(['run: npm ci --ignore-scripts false'])).toEqual(['npm ci --ignore-scripts false'])
    expect(offenders(['run: npm ci --ignore-scripts=true', '- run: npm ci --ignore-scripts # pinned'])).toEqual([])
  })

  it('reads a command continued over several lines as one', () => {
    expect(offenders(['run: npm ci \\', '  --ignore-scripts'])).toEqual([])
    expect(offenders(['run: npm \\', '  ci'])).toEqual(['npm ci'])
  })

  it('reads a quoted run value as YAML gives it to the shell', () => {
    expect(offenders(['run: "npm ci"'])).toEqual(['npm ci'])
    expect(offenders(["- run: 'npm install'"])).toEqual(['npm install'])
    expect(offenders(["- run: 'npm ci --ignore-scripts'", 'run: "npm --prefix web ci --ignore-scripts"'])).toEqual([])
  })

  it('finds installs behind options and leaves other commands alone', () => {
    expect(offenders(['run: npm --prefix streampulse-web ci'])).toEqual(['npm --prefix streampulse-web ci'])
    expect(offenders(['run: npm --cache .npm ci'])).toEqual(['npm --cache .npm ci'])
    expect(offenders(['run: npm --registry https://registry.npmjs.org/ ci --ignore-scripts'])).toEqual([])
    expect(installCommands(['run: npm --silent run build'])).toEqual([])
    expect(offenders(['npm rebuild'])).toEqual(['npm rebuild'])
    expect(installCommands(['npx playwright install chromium --with-deps', 'run: npm run build', 'npm audit --json > out'])).toEqual([])
  })
})
