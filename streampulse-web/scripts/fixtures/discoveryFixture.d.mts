export declare const FIXTURE_MONTH: string
export declare const FIXTURE_DAY: string
export declare const FIXTURE_CREATOR: string
export declare const FIXTURE_PAGE_SIZE: number

export declare const FIXTURE_BROADCASTS: ReadonlyArray<{
  streamId: string
  category: string
  detections: number
  startHour: number
}>

export declare const FIXTURE_TOTAL_DETECTIONS: number

export declare function discoveryMonthResponse(month: string, creator: string): Record<string, unknown>

export declare function discoveryDayResponse(
  month: string,
  creator: string,
  day: string,
  cursor: string,
): Record<string, unknown>

export declare function discoveryYearResponse(year: string, creator: string): Record<string, unknown>

/** Returns null when the path is not one this fixture owns. */
export declare function discoveryFixtureResponse(
  pathname: string,
  searchParams: URLSearchParams,
): Record<string, unknown> | null
