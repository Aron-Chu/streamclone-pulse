import { panelComponentCss } from '../../src/ui/panelComponentStyles.ts'

/**
 * The declarations of one single-class rule in the panel stylesheet, where
 * static component styles live instead of inline style objects.
 */
export function panelRule(className: string): string {
  const rule = new RegExp(`(?:^|\\n)\\s*\\.${className} \\{([^}]*)\\}`).exec(panelComponentCss())
  if (!rule) throw new Error(`no .${className} rule in panelComponentCss`)
  return rule[1]
}
