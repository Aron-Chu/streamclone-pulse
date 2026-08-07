export interface PulseBroadcastOptions {
  /** The requesting content tab already receives the direct response. */
  excludeTabId?: number
}

export function shouldSendPulseRuntimeBroadcast(options?: PulseBroadcastOptions): boolean {
  return options?.excludeTabId == null
}

export function shouldSendPulseToTab(
  tabId: number | undefined,
  options?: PulseBroadcastOptions,
): boolean {
  return tabId != null && tabId !== options?.excludeTabId
}
