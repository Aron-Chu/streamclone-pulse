export interface ActivityRangeOption<T extends string> {
  key: T
  label: string
  description?: string
}

/** A bounded fallback proves only its served range; preserve the requested URL choice for recovery. */
export function optionsForBoundedActivityFallback<T extends string>(
  options: ActivityRangeOption<T>[],
  requested: T,
  served: T,
): ActivityRangeOption<T>[] {
  return options.filter(option => option.key === served || option.key === requested)
}
