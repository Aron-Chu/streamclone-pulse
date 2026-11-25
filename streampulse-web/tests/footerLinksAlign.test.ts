import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Footer links share one text line (site batch 3, item 11). "Analytics preferences" is a
 * <details> whose summary has a 44px tap box, which used to make every footer row 44px
 * tall: the label sat ~12px below the plain links, and an open panel
 * stretched the row and dragged the other links to the middle of it. jsdom cannot measure
 * layout, so this pins the two declarations that fix it.
 */
const preferences = readFileSync(resolve(process.cwd(), 'src/ui/components/AnalyticsPreferences.css'), 'utf8')
const global = readFileSync(resolve(process.cwd(), 'src/ui/global.css'), 'utf8')

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  return css.match(new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('footer link alignment', () => {
  it('keeps the 44px tap box on Analytics preferences but gives it one text line of layout', () => {
    const summary = ruleBody(preferences, '.analytics-preferences > summary')
    expect(summary).toMatch(/min-height:\s*44px;/)
    // (1lh - 44px) / 2 on each side cancels the box's extra height, so the row is as tall as its links.
    expect(summary).toMatch(/margin-block:\s*calc\(\(1lh - 44px\) \/ 2\);/)
  })

  it('top-aligns the shared footer rows so an open panel moves no other link', () => {
    const row = ruleBody(global, '.app-footer__links')
    expect(row).toMatch(/display:\s*flex;/)
    expect(row).toMatch(/align-items:\s*flex-start;/)
  })
})

/** Every top-level declaration block whose selector list names `selector` exactly, joined. */
function rulesFor(css: string, selector: string): string {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some(part => part.trim() === selector))
    .map(([, , body]) => body).join('\n')
}

describe('footer brand row', () => {
  // The site's utilities exist only inside .app-shell (tailwind.public.config.js,
  // important: '.app-shell'), and the home and analytics pages have no .app-shell.
  // The brand row must look the same on every page, so its styles are footer classes.
  const footer = readFileSync(resolve(process.cwd(), 'src/ui/components/SiteFooter.tsx'), 'utf8')

  it('uses footer classes, not utilities', () => {
    const classNames = [...footer.matchAll(/className="([^"]*)"/g)].flatMap(([, value]) => value.split(/\s+/))
    expect(classNames.filter(name => name && !name.startsWith('app-footer'))).toEqual([])
    for (const name of ['app-footer__lead', 'app-footer__brand', 'app-footer__name', 'app-footer__sep', 'app-footer__tagline']) {
      expect(classNames, name).toContain(name)
    }
  })

  it('styles the row as the utilities did: a centred flex row, a bold zinc-300 name, a small zinc-400 tagline', () => {
    const lead = rulesFor(global, '.app-footer__lead')
    expect(lead).toMatch(/display:\s*flex;/)
    expect(lead).toMatch(/align-items:\s*center;/)
    expect(lead).toMatch(/gap:\s*0\.5rem;/)
    const name = rulesFor(global, '.app-footer__name')
    expect(name).toMatch(/font-weight:\s*700;/)
    expect(name).toMatch(/color:\s*#d4d4d8;/)
    expect(rulesFor(global, '.app-footer__sep')).toMatch(/color:\s*#a1a1aa;/)
    const tagline = rulesFor(global, '.app-footer__tagline')
    expect(tagline).toMatch(/color:\s*#a1a1aa;/)
    expect(tagline).toMatch(/font-size:\s*0\.75rem;/)
    expect(tagline).toMatch(/line-height:\s*1rem;/)
    // On a phone the row wraps under the brand.
    expect(global).toMatch(/@media \(max-width: 560px\) \{[^@]*\.app-footer__lead \{ flex-wrap: wrap; \}/)
  })
})
