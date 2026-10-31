import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs from streampulse-web/.
const webRoot = process.cwd()
const repoRoot = resolve(webRoot, '..')
const read = (path: string) => readFileSync(join(webRoot, path), 'utf8')

type Rgb = [number, number, number]
const hex = (value: string): Rgb => {
  const h = value.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb
}
const luminance = ([r, g, b]: Rgb) => {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
/** `top` at `alpha` over `bottom`. */
const over = (top: Rgb, alpha: number, bottom: Rgb): Rgb => top.map((v, i) => v * alpha + bottom[i]! * (1 - alpha)) as Rgb
/** hsl(h s% l%) as sRGB. */
const hsl = (h: number, s: number, l: number): Rgb => {
  const sat = s / 100
  const light = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as Rgb
}

const PAGE_BG = hex('#09090b')
/** The lightest surface small text sits on in the portal: a panel at 8% white over the page. */
const PANEL_BG = over([255, 255, 255], 0.08, PAGE_BG)

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      sourceFiles(path, out)
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(path)
    }
  }
  return out
}

describe('muted text on dark surfaces reads at 4.5:1 or more', () => {
  it('the shades the portal uses for small grey text pass on the page and on a panel', () => {
    for (const shade of ['#a1a1aa', '#94a3b8', '#b4b4bb']) {
      expect(contrast(hex(shade), PAGE_BG), `${shade} on the page`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(hex(shade), PANEL_BG), `${shade} on a panel`).toBeGreaterThanOrEqual(4.5)
    }
    // The shades they replace did not.
    for (const shade of ['#71717a', '#52525b', '#64748b']) {
      expect(contrast(hex(shade), PANEL_BG), `${shade} on a panel`).toBeLessThan(4.5)
    }
  })

  it('no portal or console source asks for the zinc/slate 500 and 600 text shades', () => {
    const offenders: string[] = []
    for (const root of [join(repoRoot, 'packages/analytics-console/src'), join(webRoot, 'src')]) {
      for (const file of sourceFiles(root)) {
        readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
          if (/\btext-(zinc|slate)-(500|600)(?![\w/])/.test(line)) offenders.push(`${file.replace(repoRoot, '')}:${index + 1}`)
        })
      }
    }
    expect(offenders).toEqual([])
  })

  it('the chart tip, the data table header and the SVG axis labels use the 400 shade', () => {
    const chart = read('src/ui/charts/sp-session-chart.css')
    expect(chart).toMatch(/\.ssc-ro-tip \{\s*color: #a1a1aa;/)
    expect(chart).toMatch(/\.ssc-md thead tr \{\s*color: #a1a1aa;/)
    expect(read('src/ui/analytics-tailwind.css')).toContain('text.fill-zinc-500 { fill: rgb(161 161 170); }')
  })

  it('the emote map share reads in the secondary hub text colour, which passes on a heated tile', () => {
    expect(read('src/ui/components/hub/v5/hub-v5.css')).toMatch(/\.hv5-em-v \{[^}]*color: var\(--sp-text-2\);/)
    const hottest = over(hex('#f43f5e'), 0.22, hex('#17171a'))
    expect(contrast(hex('#b4b4bb'), hottest)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('text on a coloured fill', () => {
  it('the analytics skip link is the page colour on the teal accent, not white', () => {
    const nav = read('src/ui/components/analytics/figma-analytics.css')
    const rule = /\.analytics-topnav__skip:focus-visible \{([^}]*)\}/.exec(nav)?.[1] ?? ''
    expect(rule).toMatch(/background: var\(--fma-accent\);/)
    expect(rule).toMatch(/color: var\(--fma-bg\);/)
    const tokens = read('src/ui/themes/analytics-themes/command-center.css')
    const accent = /--sp-accent: (#[0-9a-f]{6});/i.exec(tokens)?.[1]
    const bg = /--sp-bg: (#[0-9a-f]{6});/i.exec(tokens)?.[1]
    expect(contrast(hex(bg!), hex(accent!))).toBeGreaterThanOrEqual(4.5)
    // What it was: white on the accent.
    expect(contrast([255, 255, 255], hex(accent!))).toBeLessThan(2)
  })

  it('the home "Explore" pill keeps its white label on a rose deep enough for 4.5:1', () => {
    const css = read('src/ui/components/landing/landing.css')
    const rule = /\.sl-announce__new \{([^}]*)\}/.exec(css)?.[1] ?? ''
    const [, h, s, l] = /background: hsl\((\d+) (\d+)% (\d+)%\);/.exec(rule) ?? []
    expect(rule).toMatch(/color: white;/)
    expect(contrast([255, 255, 255], hsl(Number(h), Number(s), Number(l)))).toBeGreaterThanOrEqual(4.5)
  })
})
