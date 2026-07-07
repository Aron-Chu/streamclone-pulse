import { getBackendUrl } from '../../../lib/apiClient'
import {
  backendSourceCaption,
  backendSourceHost,
  localBackendDevCaption,
  resolveBackendSource,
} from '../../../lib/backendSource'
import { DEFAULT_PRODUCTION_BACKEND_URL, setBackendUrlOverride } from '../../../lib/auth'

export function HubBackendSourceBanner() {
  const backendUrl = getBackendUrl()
  const source = resolveBackendSource(backendUrl)
  const host = backendSourceHost(backendUrl)

  if (source === 'hosted') return null

  function handleUseHosted() {
    setBackendUrlOverride(null)
    window.location.reload()
  }

  return (
    <div
      className={`figma-hub-fallback-banner figma-hub-fallback-banner--warn figma-hub-backend-banner--${source}`}
      role="status"
      aria-live="polite"
    >
      <strong>{backendSourceCaption(backendUrl)}</strong>
      {source === 'local' ? (
        <span> {localBackendDevCaption()}</span>
      ) : (
        <span> Custom API endpoint — trends may differ from hosted production.</span>
      )}
      <span className="figma-hub-backend-banner__actions">
        <button type="button" className="figma-hub-backend-banner__btn" onClick={handleUseHosted}>
          Use hosted API
        </button>
        <span className="figma-hub-backend-banner__host" title={backendUrl}>
          {host}
        </span>
        <span className="figma-hub-backend-banner__hint">
          (production: {DEFAULT_PRODUCTION_BACKEND_URL})
        </span>
      </span>
    </div>
  )
}
