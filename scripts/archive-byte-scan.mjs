/**
 * Scan archived extension bytes for high-confidence secret/path canaries.
 * Reports rule IDs + filenames only — never logs matched secret values.
 */
import { REMOTE_CODE_SCAN_NOTE, scanRemoteCodePatterns } from './remote-code-scan.mjs'

/** Binary/media extensions where UTF-8 text decoding is inappropriate for full scans. */
export const BINARY_ASSET_ALLOWLIST = Object.freeze([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.webm',
  '.wav',
  '.ogg',
])

const PRIVATE_KEY_RE = /BEGIN (?:RSA |OPENSSH |EC |DSA |OPENSSH )?PRIVATE KEY/
const ENV_CRED_RE =
  /(?:^|[\n\r;])\s*(?:TWITCH_CLIENT_SECRET|CLIENT_SECRET|API_SECRET|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY|AWS_SECRET_ACCESS_KEY)\s*=\s*\S+/i
const BEARER_RE = /(?:Bearer|token)\s+[A-Za-z0-9\-._~+/]{20,}={0,2}/i
const ABS_PATH_RE = /(?:[A-Za-z]:\\\\Users\\\\|\/Users\/|\/home\/)[^\s"'`]{0,120}(?:streampulse|AppData|streamclone)/i
const SIBLING_PATH_RE = /file:\.\.\//
const BACKEND_PATH_RE = /streampulse-backend/
const SOURCEMAP_REF_RE = /sourceMappingURL\s*=\s*\S+\.map/i

/**
 * @param {string} rel
 * @returns {boolean}
 */
export function isBinaryAssetPath(rel) {
  const lower = String(rel ?? '').toLowerCase()
  return BINARY_ASSET_ALLOWLIST.some((ext) => lower.endsWith(ext))
}

/**
 * Decode buffer as UTF-8 when it looks text-like; otherwise scan ASCII canaries only.
 * @param {Buffer} buf
 * @returns {{ text: string|null, ascii: string }}
 */
export function decodeArchiveEntryForScan(buf) {
  const ascii = buf.toString('latin1')
  // Reject if many NUL bytes (likely binary) — still keep ascii for header canaries.
  let nul = 0
  for (let i = 0; i < Math.min(buf.length, 4096); i++) {
    if (buf[i] === 0) nul += 1
  }
  if (nul > 8) return { text: null, ascii }
  try {
    const text = buf.toString('utf8')
    if (text.includes('\uFFFD') && nul > 0) return { text: null, ascii }
    return { text, ascii }
  } catch {
    return { text: null, ascii }
  }
}

/**
 * @param {string} rel
 * @param {Buffer} buf
 * @param {{ store?: boolean }} opts
 * @returns {{ ok: boolean, hits: Array<{ ruleId: string, file: string }> }}
 */
export function scanArchiveEntryBytes(rel, buf, opts = {}) {
  const store = Boolean(opts.store)
  const hits = []
  const push = (ruleId) => hits.push({ ruleId, file: rel })

  if (/\.map$/i.test(rel)) push('sourcemap-file')
  if (/(^|\/)\.env/i.test(rel) || /\.env\./i.test(rel) || /oauth-bundle\.env$/i.test(rel)) {
    push('env-file')
  }

  const { text, ascii } = decodeArchiveEntryForScan(buf)
  const scanTarget = text ?? ascii

  if (PRIVATE_KEY_RE.test(scanTarget)) push('private-key-header')
  if (ENV_CRED_RE.test(scanTarget)) push('env-credential-assignment')
  if (BEARER_RE.test(scanTarget)) push('bearer-token-canary')
  if (ABS_PATH_RE.test(scanTarget)) push('absolute-machine-path')

  if (store) {
    if (SIBLING_PATH_RE.test(scanTarget) || BACKEND_PATH_RE.test(scanTarget)) {
      push('sibling-private-path')
    }
  }

  if (SOURCEMAP_REF_RE.test(scanTarget)) push('sourcemap-reference')

  const textLike =
    text != null
    && (!isBinaryAssetPath(rel) || /\.(pem|key|txt|env|json|js|mjs|cjs|html|css|md|map)$/i.test(rel))

  if (textLike && /\.(js|mjs|cjs|html|css)$/i.test(rel)) {
    const remote = scanRemoteCodePatterns(text)
    if (!remote.ok) {
      for (const hit of remote.hits) push(`remote-code:${hit.id}`)
    }
  }

  // Extensionless / unusual text still gets remote-code scan when UTF-8 decoded.
  if (textLike && !isBinaryAssetPath(rel) && !/\.(js|mjs|cjs|html|css|json|png|jpg|jpeg|gif|webp|woff2?)$/i.test(rel)) {
    const remote = scanRemoteCodePatterns(text)
    if (!remote.ok) {
      for (const hit of remote.hits) push(`remote-code:${hit.id}`)
    }
  }

  return { ok: hits.length === 0, hits, note: REMOTE_CODE_SCAN_NOTE }
}
