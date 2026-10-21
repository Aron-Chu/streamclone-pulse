export const EXTENSION_RUNTIME_TARGET_MARKER_PREFIX =
  'streampulse-extension-runtime-target:' as const

/**
 * Embedded in each runtime bundle and inspected by the package validator.
 * This binds compiled privacy/diagnostics behavior to the selected manifest.
 */
export const COMPILED_EXTENSION_TARGET_MARKER =
  typeof __EXTENSION_TARGET_MARKER__ === 'undefined'
    ? `${EXTENSION_RUNTIME_TARGET_MARKER_PREFIX}development`
    : __EXTENSION_TARGET_MARKER__

const RUNTIME_TARGET_MARKER_PREFIX_PATTERN = /^streampulse-extension-runtime-target:/

export function compiledExtensionTarget(): string {
  // A regex keeps the marker in the minified bundle: vite 8.1's minifier folds
  // `.slice()` on the constant marker down to the bare target string.
  return COMPILED_EXTENSION_TARGET_MARKER.replace(RUNTIME_TARGET_MARKER_PREFIX_PATTERN, '')
}
