import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  REACT_DOM_SET_INNER_HTML,
  REACT_DOM_SET_INNER_HTML_STUB,
  findDynamicHtmlAssignments,
  reactDomNoInnerHtml,
  stripReactDomSetInnerHtml,
} from '../scripts/lib/react-dom-inner-html.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const reactDomPath = resolve(root, 'node_modules/react-dom/cjs/react-dom.production.min.js')
const reactDom = readFileSync(reactDomPath, 'utf8')

describe('React DOM setInnerHTML swap (Firefox add-on lint)', () => {
  it('finds the two warned assignments in the installed React DOM and none after the swap', () => {
    expect(findDynamicHtmlAssignments(reactDom)).toHaveLength(2)
    const patched = stripReactDomSetInnerHtml(reactDom)
    expect(findDynamicHtmlAssignments(patched)).toEqual([])
    expect(patched).toContain(REACT_DOM_SET_INNER_HTML_STUB)
    // React's own <script> placeholder is a plain string and stays.
    expect(patched).toContain('a.innerHTML="<script>\\x3c/script>"')
  })

  it('fails the build when React DOM no longer carries the exact function', () => {
    expect(() => stripReactDomSetInnerHtml('var nb=function(){}')).toThrow(/found 0 time/)
    expect(() => stripReactDomSetInnerHtml(REACT_DOM_SET_INNER_HTML + REACT_DOM_SET_INNER_HTML)).toThrow(
      /more than 1/,
    )
  })

  it('only transforms React DOM production, including Windows paths and query ids', () => {
    const plugin = reactDomNoInnerHtml()
    expect(plugin.transform('a.innerHTML=b', '/repo/src/content/entry.ts')).toBeNull()
    expect(plugin.transform('x', '/repo/node_modules/react-dom/cjs/react-dom.development.js')).toBeNull()
    const windowsId = 'C:\\repo\\node_modules\\react-dom\\cjs\\react-dom.production.min.js?commonjs-entry'
    expect(plugin.transform(reactDom, windowsId)?.code).toContain(REACT_DOM_SET_INNER_HTML_STUB)
  })

  it('flags HTML assignments the linter warns on and lets plain strings through', () => {
    expect(findDynamicHtmlAssignments('e.innerHTML=t')).toHaveLength(1)
    expect(findDynamicHtmlAssignments('He.innerHTML=`<svg>`+t.valueOf().toString()+`</svg>`')).toHaveLength(1)
    expect(findDynamicHtmlAssignments('x.innerHTML = `<b>${name}</b>`;')).toHaveLength(1)
    expect(findDynamicHtmlAssignments('a.outerHTML+="<i></i>"')).toHaveLength(1)
    expect(findDynamicHtmlAssignments('a.innerHTML="<script></script>",a=b')).toEqual([])
    expect(findDynamicHtmlAssignments("a.innerHTML='';")).toEqual([])
    expect(findDynamicHtmlAssignments('a.innerHTML=`<script><\\/script>`)')).toEqual([])
    expect(findDynamicHtmlAssignments('if(a.innerHTML==b)c()')).toEqual([])
    expect(findDynamicHtmlAssignments('const s=document.documentElement.innerHTML')).toEqual([])
  })
})
