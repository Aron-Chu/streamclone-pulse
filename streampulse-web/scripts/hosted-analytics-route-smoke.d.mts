export declare const HOSTED_ANALYTICS_ORIGIN: string
export declare const HOSTED_ANALYTICS_DEEP_PATHS: readonly string[]

export declare function verifyHostedAnalyticsRoutes(options?: {
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>
  origin?: string
  paths?: readonly string[]
}): Promise<Array<{ route: string; status: number }>>
