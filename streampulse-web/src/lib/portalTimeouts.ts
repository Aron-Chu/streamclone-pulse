export const PORTAL_MINUTES_TIMEOUT_MS = 120_000

/**
 * Opt-in apiClient deadline for the large first-paint reads (24h and longer hub
 * bodies, session detail, hosted channel live frame, sessions-view story). A
 * slow network can stretch them past the 8 s default, which aborted responses
 * that would have arrived (CIR-M5b). Other calls, the 30-minute hub reads
 * included, keep the default.
 */
export const SLOW_READ_TIMEOUT_MS = 20_000
