export declare const REACT_ROUTER_URL_BASE: string

export declare function isForbiddenBackendHostname(hostname: string | null | undefined): boolean

export declare function findForbiddenBackendHosts(text: string): string[]

export declare function findForbiddenBackendUrlHits(text: string): string[]

export declare function countBareLocalhostSentinel(text: string): number

export declare function analyzePortalDistForLocalOrigins(distDir?: string): {
  forbidden: Array<{ file: string; needle: string }>
  sentinelTotal: number
  sentinelFiles: Array<{ file: string; count: number }>
  files: string[]
}
