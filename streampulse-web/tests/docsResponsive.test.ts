import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it('wraps API references and account identity at narrow widths', () => {
 const css = readFileSync('src/ui/global.css', 'utf8')
 expect(css).toMatch(/\.public-api-reference[\s\S]*?overflow-wrap:\s*anywhere/)
})
