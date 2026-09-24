import type { BackgroundResponse } from '../shared/messages.ts'

type RuntimeUpdateResult = {
  status?: 'no_update' | 'current' | 'update_available' | 'throttled' | string
  version?: string
}

type RuntimeWithUpdateCheck = {
  requestUpdateCheck?: () => Promise<RuntimeUpdateResult>
}

function runtimeApi(): RuntimeWithUpdateCheck | null {
  if (typeof chrome === 'undefined' || !chrome.runtime) return null
  return chrome.runtime as unknown as RuntimeWithUpdateCheck
}

export function getUpdateCheckCapability(options: {
  storeBuild?: boolean
  runtime?: RuntimeWithUpdateCheck | null
} = {}): Extract<BackgroundResponse, { type: 'UPDATE_CHECK_CAPABILITY' }> {
  const storeBuild = options.storeBuild
    ?? (typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__)
  if (!storeBuild) {
    return { type: 'UPDATE_CHECK_CAPABILITY', supported: false, managedBy: 'development' }
  }
  const runtime = options.runtime === undefined ? runtimeApi() : options.runtime
  return {
    type: 'UPDATE_CHECK_CAPABILITY',
    supported: typeof runtime?.requestUpdateCheck === 'function',
    managedBy: 'browser',
  }
}

export async function requestBrowserUpdateCheck(options: {
  storeBuild?: boolean
  runtime?: RuntimeWithUpdateCheck | null
} = {}): Promise<Extract<BackgroundResponse, { type: 'UPDATE_CHECK' }>> {
  const capability = getUpdateCheckCapability(options)
  const runtime = options.runtime === undefined ? runtimeApi() : options.runtime
  if (!capability.supported || typeof runtime?.requestUpdateCheck !== 'function') {
    return { type: 'UPDATE_CHECK', status: 'unsupported' }
  }
  try {
    const result = await runtime.requestUpdateCheck()
    if (result.status === 'update_available') {
      return { type: 'UPDATE_CHECK', status: 'update_available', version: result.version }
    }
    if (result.status === 'throttled') {
      return { type: 'UPDATE_CHECK', status: 'throttled' }
    }
    if (result.status === 'no_update' || result.status === 'current') {
      return { type: 'UPDATE_CHECK', status: 'current' }
    }
    return { type: 'UPDATE_CHECK', status: 'error', error: 'unknown_update_status' }
  } catch (error) {
    return {
      type: 'UPDATE_CHECK',
      status: 'error',
      error: error instanceof Error ? error.message.slice(0, 160) : 'update_check_failed',
    }
  }
}
