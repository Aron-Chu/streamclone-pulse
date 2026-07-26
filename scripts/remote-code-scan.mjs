/**
 * Best-effort remote-code static scan using structured cues + conservative
 * regex fallback for minified assets.
 * Supplements — does not replace — human Chrome Web Store review.
 */

const FORBIDDEN = [
  { id: 'eval', re: /\beval\s*\(/ },
  { id: 'indirect-eval', re: /\(\s*0\s*,\s*eval\s*\)\s*\(/ },
  { id: 'function-call', re: /(?<![.\w$])Function\s*\(/ },
  { id: 'new-function', re: /\bnew\s+Function\s*\(/ },
  { id: 'window-function', re: /\bwindow\.Function\s*(?:\(|`)/ },
  { id: 'globalthis-function', re: /\bglobalThis\.Function\s*(?:\(|`)/ },
  { id: 'string-settimeout', re: /\bsetTimeout\s*\(\s*['"`]/ },
  { id: 'string-setinterval', re: /\bsetInterval\s*\(\s*['"`]/ },
  { id: 'remote-import', re: /\bimport\s*\(\s*['"`]https?:\/\//i },
  { id: 'remote-static-import', re: /\bimport\s+[^;]*['"`]https?:\/\//i },
  { id: 'importScripts', re: /\bimportScripts\s*\(/ },
  { id: 'remote-worker', re: /\bnew\s+(?:Shared)?Worker\s*\(\s*['"`]https?:\/\//i },
  { id: 'remote-script-src', re: /(?:createElement\s*\(\s*['"`]script['"`]\s*\)[\s\S]{0,200}\.src\s*=\s*['"`]https?:\/\/|<script[^>]+src\s*=\s*['"`]https?:\/\/)/i },
  { id: 'wasm-instantiate', re: /WebAssembly\.instantiate\s*\(/ },
  { id: 'wasm-instantiateStreaming', re: /WebAssembly\.instantiateStreaming\s*\(/ },
  { id: 'wasm-compile', re: /WebAssembly\.compile\s*\(/ },
  { id: 'wasm-compileStreaming', re: /WebAssembly\.compileStreaming\s*\(/ },
  // Fetched source fed into eval/Function/import/Worker (conservative).
  { id: 'fetch-to-eval', re: /fetch\s*\([^)]*\)[\s\S]{0,240}\.then\s*\([^)]*\)[\s\S]{0,120}\beval\s*\(/ },
  { id: 'fetch-to-function', re: /fetch\s*\([^)]*\)[\s\S]{0,240}(?:new\s+)?Function\s*\(/ },
  { id: 'fetch-to-worker', re: /fetch\s*\([^)]*\)[\s\S]{0,240}new\s+(?:Shared)?Worker\s*\(/ },
]

/**
 * @returns {{ ok: boolean, hits: Array<{ id: string, match: string }> }}
 */
export function scanRemoteCodePatterns(source) {
  const text = String(source ?? '')
  const hits = []
  const seen = new Set()
  for (const rule of FORBIDDEN) {
    const m = text.match(rule.re)
    if (m) {
      const key = `${rule.id}:${m[0].slice(0, 40)}`
      if (seen.has(key)) continue
      seen.add(key)
      hits.push({ id: rule.id, match: m[0].slice(0, 80) })
    }
  }
  return { ok: hits.length === 0, hits }
}

export const REMOTE_CODE_SCAN_NOTE =
  'Automated remote-code scanning supplements, but does not replace, human Chrome Web Store review.'
