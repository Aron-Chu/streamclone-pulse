import ts from 'typescript'

/**
 * Exact per-target permission allowlists for extension packaging validation.
 *
 * Twitch host grant: `https://*.twitch.tv/*` is retained so MV3
 * chrome.scripting.executeScript can target Twitch channel/VOD pages
 * (www, m, clips, and related subdomains). That wildcard also covers
 * gql.twitch.tv for extension-origin network access, but StreamPulse does
 * not declare a separate `https://gql.twitch.tv/*` entry and does not fetch
 * GQL from the extension origin — discovery runs in page MAIN world
 * (see src/background/twitchPageInject.ts) using the page network context.
 *
 * Narrowing to `https://www.twitch.tv/*` alone would drop content-script /
 * scripting coverage for non-www Twitch hosts used by channel and mobile
 * surfaces; keep the wildcard until product confirms www-only injection.
 */
/**
 * No `identity` while Sign in with Twitch is compiled off
 * (TWITCH_SIGNIN_ENABLED in src/shared/twitchSignIn.ts): store review rejects
 * a permission the package never uses. The release that turns the flag on adds
 * `identity` here, to every manifest, and to the store permission docs
 * together. Never add `identity.email`.
 */
export const ALLOWED_PERMISSIONS = Object.freeze(['storage', 'scripting'])

/**
 * Store builds fetch only from the StreamPulse API, and the Twitch wildcard
 * covers the content script, scripting and the popup reading the active tab's
 * Twitch URL. Emote, avatar and box-art images are plain <img> elements, which
 * need no host permission, and store builds never fetch image bytes
 * (src/background/emoteImageFetch.ts). Dropping hosts lowers privilege, so
 * existing installs update without a permission prompt.
 */
export const ALLOWED_HOST_PERMISSIONS_STORE = Object.freeze([
  'https://api.streampulse.stream/*',
  'https://*.twitch.tv/*',
])

/** Development builds keep the emote CDN hosts they have always requested. */
export const ALLOWED_HOST_PERMISSIONS_DEVELOPMENT = Object.freeze([
  'https://api.streampulse.stream/*',
  'https://cdn.7tv.app/*',
  'https://cdn.betterttv.net/*',
  'https://cdn.streampulse.stream/*',
  'https://static-cdn.jtvnw.net/*',
  'https://cdn.frankerfacez.com/*',
  'https://*.twitch.tv/*',
])

export const ALLOWED_OPTIONAL_HOST_PERMISSIONS_DEVELOPMENT = Object.freeze([
  'http://localhost:8081/*',
  'http://127.0.0.1:8081/*',
])

export function permissionAllowlistForTarget(target) {
  const permissions = [...ALLOWED_PERMISSIONS]
  const host_permissions = target === 'development'
    ? [...ALLOWED_HOST_PERMISSIONS_DEVELOPMENT]
    : [...ALLOWED_HOST_PERMISSIONS_STORE]
  const optional_host_permissions =
    target === 'development' ? [...ALLOWED_OPTIONAL_HOST_PERMISSIONS_DEVELOPMENT] : []
  return { permissions, host_permissions, optional_host_permissions }
}

/** Exact set equality (order-sensitive for stable manifests). */
export function assertExactStringList(actual, expected, label) {
  const a = actual ?? []
  const e = expected ?? []
  const errors = []
  if (a.length !== e.length) {
    errors.push(`${label}: length ${a.length} != ${e.length}`)
  }
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] !== e[i]) {
      errors.push(`${label}[${i}]: got ${JSON.stringify(a[i])} expected ${JSON.stringify(e[i])}`)
    }
  }
  for (const item of a) {
    if (!e.includes(item)) errors.push(`${label}: unexpected ${JSON.stringify(item)}`)
  }
  for (const item of e) {
    if (!a.includes(item)) errors.push(`${label}: missing ${JSON.stringify(item)}`)
  }
  return errors
}

/**
 * Packaging must fail closed if an upload switch stops being a literal:
 * a future refactor must teach the package gate how to verify it first.
 */
export function readExportedBooleanFlag(source, name) {
  const file = ts.createSourceFile('upload-switch.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (file.parseDiagnostics.length) throw new Error(`Cannot parse source for ${name}`)
  const matches = []
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        matches.push({ statement, declaration })
      }
    }
  }
  if (matches.length !== 1) throw new Error(`${name} must have exactly one declaration`)
  const { statement, declaration } = matches[0]
  const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
  const ambient = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)
  const constant = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
  const kind = declaration.initializer?.kind
  if (!exported || ambient || !constant || (kind !== ts.SyntaxKind.TrueKeyword && kind !== ts.SyntaxKind.FalseKeyword)) {
    throw new Error(`${name} must be an exported const with a literal boolean value`)
  }
  return kind === ts.SyntaxKind.TrueKeyword
}

/**
 * The browser-owned technical-data permission is needed only when at least
 * one separately consented upload is compiled in. Both the source and the
 * built manifest must match this exact, intentionally narrow declaration.
 */
export function firefoxDataCollectionErrors(actual, source, analyticsEnabled, diagnosticsEnabled) {
  if (typeof analyticsEnabled !== 'boolean' || typeof diagnosticsEnabled !== 'boolean') {
    return ['Firefox upload flags must be booleans']
  }
  const expected = {
    required: ['browsingActivity', 'authenticationInfo', 'financialAndPaymentInfo'],
    ...(analyticsEnabled || diagnosticsEnabled ? { optional: ['technicalAndInteraction'] } : {}),
  }
  const errors = []
  if (JSON.stringify(source) !== JSON.stringify(expected)) {
    errors.push('Firefox source data collection declaration does not match upload switches')
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push('Firefox built data collection declaration does not match upload switches')
  }
  return errors
}
