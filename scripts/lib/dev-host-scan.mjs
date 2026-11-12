/**
 * Development-only hosts and ports that a store bundle must not carry, in any
 * spelling. The plain patterns in validate-extension-package.mjs catch
 * `localhost:8081` or `127.0.0.1`, but not a value a bundle assembles at run
 * time: String.fromCharCode lists, char-code or octet arrays joined together,
 * string escapes, percent-encoding, base64, concatenation or reversal. This
 * scan decodes those forms and reports what they spell. Store reviewers treat
 * hidden values as obfuscation, so a store build must not need any of them.
 */

const DEV_WORDS = Object.freeze(['localhost', 'laptopworker'])
const DEV_PORTS = Object.freeze(['8081', '8090', '5173'])
const LOOPBACK_IPV4 = '127.0.0.1'

/** Plain spellings the package gate also rejects in store bundles. */
export const PLAIN_DEV_HOST_PATTERNS = Object.freeze([
  /localhost/i,
  /laptopworker/i,
  /\b127\.0\.0\.1\b/,
  /\[::1\]/,
  new RegExp(`["'\`]:?(?:${DEV_PORTS.join('|')})["'\`]`),
])

const NUMBER = String.raw`(?:0x[0-9a-f]+|\d+)`
const FROM_CHAR_CODE_RE = new RegExp(String.raw`(?:String\s*\.\s*)?fromCharCode\(\s*(${NUMBER}(?:\s*,\s*${NUMBER})*)\s*\)`, 'gi')
const NUMBER_ARRAY_RE = /\[\s*(\d{1,3}(?:\s*,\s*\d{1,3}){2,})\s*\]/g
const STRING_ARRAY_JOIN_RE = /\[((?:\s*(["'`])[^"'`\\]*\2\s*,?)+)\]\s*\.\s*join\(\s*(?:(["'`])([^"'`\\]*)\3)?\s*\)/g
const NUMBER_ARRAY_JOIN_RE = /\[\s*(\d{1,3}(?:\s*,\s*\d{1,3}){2,})\s*\]\s*\.\s*join\(\s*(?:(["'`])([^"'`\\]*)\2)?\s*\)/g
const ESCAPE_RE = /\\x([0-9a-f]{2})|\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})/gi
const PERCENT_RUN_RE = /(?:%[0-9a-f]{2}){3,}/gi
const CONCAT_RE = /(["'`])\s*\+\s*(["'`])/g
const LOOPBACK_INTEGER_RE = /\b(?:2130706433|0x7f000001)\b/i

function toNumber(token) {
  return /^0x/i.test(token) ? Number.parseInt(token.slice(2), 16) : Number(token)
}

function decodeCodes(list) {
  const codes = list.split(',').map(token => toNumber(token.trim()))
  if (codes.some(code => !Number.isInteger(code) || code < 0 || code > 0x10ffff)) return null
  return String.fromCodePoint(...codes)
}

function base64Needles(word) {
  // Base64 of a word depends on its offset in the encoded text, so match the
  // stable middle of its encoding at each of the three alignments.
  // Only whole 3-byte groups that hold word bytes alone are stable.
  const needles = []
  for (let shift = 0; shift < 3; shift++) {
    const encoded = Buffer.concat([Buffer.alloc(shift), Buffer.from(word)]).toString('base64')
    const start = shift ? 4 : 0
    const end = Math.floor((word.length + shift) / 3) * 4
    if (end - start >= 8) needles.push(encoded.slice(start, end))
  }
  return needles
}

const BASE64_NEEDLES = [...DEV_WORDS, LOOPBACK_IPV4].map(word => ({ word, needles: base64Needles(word) }))
const REVERSED = [...DEV_WORDS, LOOPBACK_IPV4].map(word => ({ word, reversed: [...word].reverse().join('') }))

/** What a decoded fragment spells, if it is a development host or port. */
function devValue(fragment) {
  const value = String(fragment)
  for (const word of DEV_WORDS) if (value.toLowerCase().includes(word)) return word
  if (value.includes(LOOPBACK_IPV4)) return LOOPBACK_IPV4
  const bare = value.replace(/^\[|\]$/g, '')
  if (bare === '::1') return '::1'
  const port = value.replace(/^:/, '')
  if (DEV_PORTS.includes(port)) return port
  return null
}

/**
 * Development hosts and ports spelled in encoded form.
 *
 * @param {string} text
 * @returns {{ form: string, value: string }[]}
 */
export function findEncodedDevHosts(text) {
  const source = String(text ?? '')
  const hits = []
  const seen = new Set()
  const add = (form, fragment) => {
    const value = devValue(fragment)
    if (!value) return
    const key = `${form}:${value}`
    if (seen.has(key)) return
    seen.add(key)
    hits.push({ form, value })
  }

  // fromCharCode(...) lists, then the same text with each call replaced by
  // the string it builds, so arrays of those calls joined together resolve.
  const decodedCalls = source.replace(FROM_CHAR_CODE_RE, (_, list) => {
    const decoded = decodeCodes(list)
    if (decoded === null) return _
    add('String.fromCharCode', decoded)
    return `"${decoded.replace(/["\\]/g, '')}"`
  })

  for (const match of decodedCalls.matchAll(STRING_ARRAY_JOIN_RE)) {
    const parts = [...match[1].matchAll(/(["'`])([^"'`\\]*)\1/g)].map(part => part[2])
    add('array join', parts.join(match[4] ?? ','))
  }
  for (const match of source.matchAll(NUMBER_ARRAY_JOIN_RE)) {
    add('array join', match[1].split(',').map(part => part.trim()).join(match[3] ?? ','))
  }
  for (const match of source.matchAll(NUMBER_ARRAY_RE)) {
    const codes = match[1].split(',').map(part => Number(part.trim()))
    if (codes.every(code => code >= 32 && code <= 126)) add('char-code array', String.fromCharCode(...codes))
  }

  const unescaped = source.replace(ESCAPE_RE, (_, hex, braced, unicode) =>
    String.fromCodePoint(Number.parseInt(hex ?? braced ?? unicode, 16)))
  const joined = source.replace(CONCAT_RE, '')
  for (const word of [...DEV_WORDS, LOOPBACK_IPV4]) {
    if (source.toLowerCase().includes(word)) continue
    if (unescaped.toLowerCase().includes(word)) add('string escape', word)
    if (joined.toLowerCase().includes(word)) add('concatenation', word)
  }

  for (const match of source.matchAll(PERCENT_RUN_RE)) {
    try {
      add('percent-encoding', decodeURIComponent(match[0]))
    } catch {
      // Not a UTF-8 run; nothing to decode.
    }
  }

  for (const { word, needles } of BASE64_NEEDLES) {
    if (needles.some(needle => source.includes(needle))) add('base64', word)
  }
  for (const { word, reversed } of REVERSED) {
    if (source.toLowerCase().includes(reversed)) add('reversed', word)
  }
  if (LOOPBACK_INTEGER_RE.test(source)) add('integer address', LOOPBACK_IPV4)

  return hits
}

/**
 * Every development host or port a store bundle spells, plain or encoded.
 *
 * @param {string} text
 * @returns {string[]} one line per finding, for the gate's FAIL output
 */
export function describeStoreDevHosts(text) {
  const source = String(text ?? '')
  const plain = PLAIN_DEV_HOST_PATTERNS.filter(re => re.test(source)).map(re => `plain ${re}`)
  const encoded = findEncodedDevHosts(source).map(hit => `${hit.form} spelling ${JSON.stringify(hit.value)}`)
  return [...plain, ...encoded]
}
