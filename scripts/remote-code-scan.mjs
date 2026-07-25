/**
 * Best-effort remote-code static scan using structured cues.
 * Supplements — does not replace — human Chrome Web Store review.
 */
const FORBIDDEN = [
  { id: 'eval', re: /\beval\s*\(/ },
  { id: 'indirect-eval', re: /\(\s*0\s*,\s*eval\s*\)\s*\(/ },
  { id: 'new-function', re: /\bnew\s+Function\s*\(/ },
  { id: 'string-settimeout', re: /\bsetTimeout\s*\(\s*['"`]/ },
  { id: 'string-setinterval', re: /\bsetInterval\s*\(\s*['"`]/ },
  { id: 'remote-import', re: /\bimport\s*\(\s*['"`]https?:\/\//i },
  { id: 'remote-static-import', re: /\bimport\s+[^;]*['"`]https?:\/\//i },
  { id: 'importScripts', re: /\bimportScripts\s*\(/ },
  { id: 'remote-worker', re: /\bnew\s+(?:Shared)?Worker\s*\(\s*['"`]https?:\/\//i },
  { id: 'remote-script-src', re: /<script[^>]+src\s*=\s*['"`]https?:\/\//i },
  { id: 'wasm-streaming', re: /WebAssembly\.instantiateStreaming\s*\(/ },
  { id: 'wasm-instantiate', re: /WebAssembly\.instantiate\s*\(/ },
]

/**
 * @returns {{ ok: boolean, hits: Array<{ id: string, match: string }> }}
 */
export function scanRemoteCodePatterns(source) {
  const text = String(source ?? '')
  const hits = []
  for (const rule of FORBIDDEN) {
    const m = text.match(rule.re)
    if (m) hits.push({ id: rule.id, match: m[0].slice(0, 80) })
  }
  return { ok: hits.length === 0, hits }
}

export const REMOTE_CODE_SCAN_NOTE =
  'Automated remote-code scanning supplements, but does not replace, human Chrome Web Store review.'
