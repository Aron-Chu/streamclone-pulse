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

const installCommands = (lines: string[]) =>
  lines.flatMap((line) => [...line.matchAll(/\bnpm (?:ci|install|i)\b[^#]*/g)].map((match) => match[0].trim()))

describe('workflow dependency installs', () => {
  it('finds the installs it checks', () => {
    expect(workflows.flatMap(({ lines }) => installCommands(lines)).length).toBeGreaterThanOrEqual(5)
  })

  it('runs every npm install with install scripts off', () => {
    const offenders = workflows.flatMap(({ name, lines }) =>
      installCommands(lines)
        .filter((command) => !command.includes('--ignore-scripts'))
        .map((command) => `${name}: ${command}`),
    )
    expect(offenders).toEqual([])
  })

  it('uses the flag, not the env setting that also skips pre/post hooks', () => {
    for (const { name, lines } of workflows) {
      expect(lines.join('\n'), name).not.toMatch(/npm_config_ignore_scripts/i)
    }
  })
})
