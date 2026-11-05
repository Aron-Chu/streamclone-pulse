import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  type ReactElement,
  type ReactNode,
} from 'react'

type WithChildren = { children?: ReactNode }

/** Direct children of a node, with fragments opened and every element still keyed. */
function flatten(children: ReactNode, prefix = ''): ReactNode[] {
  const out: ReactNode[] = []
  for (const child of Children.toArray(children)) {
    if (isValidElement<WithChildren>(child) && child.type === Fragment) {
      out.push(...flatten(child.props.children, `${prefix}${child.key ?? ''}/`))
    } else if (isValidElement(child) && prefix) {
      out.push(cloneElement(child, { key: `${prefix}${child.key ?? ''}` }))
    } else {
      out.push(child)
    }
  }
  return out
}

const isH2 = (node: ReactNode): node is ReactElement<WithChildren> => isValidElement(node) && node.type === 'h2'

/** A `<section>` that opens with its own `<h2>`: the heading, and the section without it. */
function sectionOpeningWithHeading(node: ReactNode): { heading: ReactElement<WithChildren>; section: ReactElement<WithChildren> } | null {
  if (!isValidElement<WithChildren>(node) || node.type !== 'section') return null
  const [first, ...rest] = flatten(node.props.children)
  if (!isH2(first)) return null
  return { heading: first, section: cloneElement(node, undefined, ...rest) }
}

/**
 * A legal page's body is a flat run of `<h2>` headings with the text under each.
 * This folds that run into sections without touching the text: every top-level
 * `<h2>` (or `<section>` that opens with one) becomes the heading of a collapsed
 * `<details>`, and whatever follows it, up to the next heading, becomes its body.
 *
 * The headings stay real `<h2>` elements (ids and classes kept, so `#supporter`
 * and `#feedback-form` still point at them), now inside the `<summary>`. A link
 * to one of them opens its section: `scrollToHashTarget` opens every closed
 * `<details>` around its target. Without JavaScript the sections still open and
 * close natively, and all of the text is in the page.
 *
 * It groups at render time, so a page file needs only this wrapper around its
 * sections: no heading or paragraph line moves, which keeps edits to the text
 * (from other branches) applying cleanly. Nothing before the first heading is
 * folded, so a page keeps its summary block open above the sections.
 */
export function FoldedSections({ children }: { children: ReactNode }) {
  // Printing a page prints only the open sections, so open them all for the print
  // and put each back as the reader had it.
  useEffect(() => {
    let closed: HTMLDetailsElement[] = []
    const beforePrint = () => {
      closed = [...document.querySelectorAll<HTMLDetailsElement>('details[data-fold]')].filter((fold) => !fold.open)
      for (const fold of closed) fold.open = true
    }
    const afterPrint = () => {
      for (const fold of closed) fold.open = false
      closed = []
    }
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', afterPrint)
    return () => {
      window.removeEventListener('beforeprint', beforePrint)
      window.removeEventListener('afterprint', afterPrint)
    }
  }, [])

  const nodes = flatten(children)
  const out: ReactNode[] = []
  let fold: { key: string; heading: ReactElement; body: ReactNode[] } | null = null
  const close = () => {
    if (!fold) return
    out.push(
      <details key={`fold:${fold.key}`} className="public-fold" data-fold="">
        <summary className="public-fold__summary">{fold.heading}</summary>
        <div className="public-fold__body">{fold.body}</div>
      </details>,
    )
    fold = null
  }
  for (const node of nodes) {
    const opening = sectionOpeningWithHeading(node)
    if (isH2(node)) {
      close()
      fold = { key: String(node.key ?? out.length), heading: node, body: [] }
    } else if (opening) {
      close()
      fold = { key: String(opening.section.key ?? out.length), heading: opening.heading, body: [opening.section] }
    } else if (fold) {
      fold.body.push(node)
    } else {
      out.push(node)
    }
  }
  close()
  return <>{out}</>
}
