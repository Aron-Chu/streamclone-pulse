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

describe('stale hub lists (G1, 11-02)', () => {
  const css = read('src/ui/components/hub/v5/hub-v5.css')
  const LIST = '.hv5-f2-stale :is(.hv5-fd-list, .hv5-tm-list), .hv5-up-old'
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`)
    return at < 0 ? null : css.slice(at + selector.length + 2, css.indexOf('}', at))
  }

  it('grey the rows with a filter, never by fading the text', () => {
    const list = rule(LIST)
    expect(list).toMatch(/filter: grayscale\(1\);/)
    expect(list).not.toMatch(/opacity/)
  })

  it('fade only the pictures in those rows', () => {
    expect(rule(`.hv5-f2-stale :is(.hv5-fd-list, .hv5-tm-list) :is(img, .hv5-mono), .hv5-up-old :is(img, .hv5-mono)`)).toMatch(/opacity: \.55;/)
    // Nothing else under a stale list asks for an opacity.
    const staleRules = [...css.matchAll(/([^{}]*\.(?:hv5-f2-stale|hv5-up-old)[^{}]*)\{([^}]*)\}/g)]
    for (const [, selector, body] of staleRules) {
      if (/opacity/.test(body!)) expect(selector!.trim(), selector).toMatch(/:is\(img, \.hv5-mono\)$/)
    }
  })
})

describe('text on a coloured fill', () => {
  it('the site skip link is the shared .sc-skip: the primary label on the primary fill (one header, 11-24)', () => {
    // The pair itself is checked at WCAG AA in siteMenuContrast.test.ts (landing primary button contrast).
    const rule = /\.sc-skip:focus-visible \{([^}]*)\}/.exec(read('src/ui/tokens.css'))?.[1] ?? ''
    expect(rule).toMatch(/background: hsl\(var\(--sc-primary\)\);/)
    expect(rule).toMatch(/color: hsl\(var\(--sc-primary-foreground\)\);/)
    expect(read('src/ui/components/SiteHeader.tsx')).toContain('className="sc-skip"')
    expect(read('src/ui/components/site-header.css')).not.toMatch(/__skip/)
  })
})
