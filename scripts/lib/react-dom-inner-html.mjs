/**
 * Firefox's add-on linter warns about every innerHTML / outerHTML assignment
 * whose value isn't a plain string (UNSAFE_VAR_ASSIGNMENT). The only ones in
 * the extension come from React DOM's setInnerHTML, which React calls for
 * `dangerouslySetInnerHTML` and nothing else. The extension never uses that
 * prop, so its builds swap the function for one that throws.
 *
 * The swap matches React DOM 18.3.1's production file exactly and fails the
 * build when that text is missing, so a React upgrade can't quietly bring the
 * warnings back. The package validator runs `findDynamicHtmlAssignments` over
 * every store bundle as a second guard.
 */

/** React DOM 18.3.1 setInnerHTML, as it appears in cjs/react-dom.production.min.js. */
export const REACT_DOM_SET_INNER_HTML =
  '(function(a,b){if("http://www.w3.org/2000/svg"!==a.namespaceURI||"innerHTML"in a)a.innerHTML=b;else{mb=mb||document.createElement("div");mb.innerHTML="<svg>"+b.valueOf().toString()+"</svg>";for(b=mb.firstChild;a.firstChild;)a.removeChild(a.firstChild);for(;b.firstChild;)a.appendChild(b.firstChild)}})'

export const REACT_DOM_SET_INNER_HTML_STUB =
  '(function(){throw Error("dangerouslySetInnerHTML is off in the StreamPulse extension")})'

const REACT_DOM_PRODUCTION = '/react-dom/cjs/react-dom.production.min.js'

/** Swap React DOM's setInnerHTML for the throwing stub; throws if it isn't there exactly once. */
export function stripReactDomSetInnerHtml(code) {
  const first = code.indexOf(REACT_DOM_SET_INNER_HTML)
  const again = first < 0 ? -1 : code.indexOf(REACT_DOM_SET_INNER_HTML, first + 1)
  if (first < 0 || again >= 0) {
    throw new Error(
      `react-dom setInnerHTML found ${first < 0 ? 0 : 'more than 1'} time(s), expected 1. ` +
        'React DOM changed: update scripts/lib/react-dom-inner-html.mjs so the Firefox add-on linter stays clean.',
    )
  }
  return code.slice(0, first) + REACT_DOM_SET_INNER_HTML_STUB + code.slice(first + REACT_DOM_SET_INNER_HTML.length)
}

/** Vite plugin: applies the swap to React DOM's production file in every extension build that bundles it. */
export function reactDomNoInnerHtml() {
  return {
    name: 'streampulse-react-dom-no-inner-html',
    enforce: 'pre',
    transform(code, id) {
      const path = id.replaceAll('\\', '/').split('?')[0]
      if (!path.endsWith(REACT_DOM_PRODUCTION)) return null
      return { code: stripReactDomSetInnerHtml(code), map: null }
    },
  }
}

const HTML_ASSIGNMENT = /\.(?:inner|outer)HTML\s*\+?=(?!=)\s*/g
const STRING_LITERAL = /^(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\$]|\\.|\$(?!\{))*`)\s*(?:[,;)}\]]|$)/

/**
 * Offsets of innerHTML / outerHTML assignments whose value isn't one plain
 * string, the shape Firefox's add-on linter warns about.
 */
export function findDynamicHtmlAssignments(code) {
  const offsets = []
  for (const match of code.matchAll(HTML_ASSIGNMENT)) {
    const valueStart = match.index + match[0].length
    const isAppend = match[0].includes('+=')
    if (isAppend || !STRING_LITERAL.test(code.slice(valueStart, valueStart + 4096))) offsets.push(match.index)
  }
  return offsets
}
