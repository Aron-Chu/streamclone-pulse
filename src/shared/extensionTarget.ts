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

export function compiledExtensionTarget(): string {
  return COMPILED_EXTENSION_TARGET_MARKER.slice(
    EXTENSION_RUNTIME_TARGET_MARKER_PREFIX.length,
  )
}
