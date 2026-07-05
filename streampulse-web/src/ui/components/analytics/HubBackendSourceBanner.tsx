import { useMemo, useState } from "react";
import { getBackendUrl } from "../../../lib/apiClient";
import {
  backendSourceCaption,
  backendSourceHost,
  isEnvLocalBackendDefault,
  resolveBackendSource,
} from "../../../lib/backendSource";
import {
  DEV_BACKEND_ENDPOINTS,
  devBackendSessionOverrideForPreset,
  resolveDevBackendEndpointId,
  type DevBackendEndpointId,
} from "../../../lib/backendEndpoints";
import {
  DEFAULT_PRODUCTION_BACKEND_URL,
  getBackendUrlOverride,
  setBackendUrlOverride,
} from "../../../lib/auth";

export function HubBackendSourceBanner() {
  const [cleared, setCleared] = useState(false);
  const backendUrl = getBackendUrl();
  const source = resolveBackendSource(backendUrl);
  const activePreset = resolveDevBackendEndpointId(backendUrl);
  const sessionOverrideRaw = useMemo(
    () => getBackendUrlOverride(),
    [cleared, backendUrl],
  );
  const sessionOverride =
    sessionOverrideRaw && sessionOverrideRaw !== DEFAULT_PRODUCTION_BACKEND_URL
      ? sessionOverrideRaw
      : null;
  const envLocalDefault = isEnvLocalBackendDefault() && !sessionOverride;
  const host = backendSourceHost(backendUrl);

  function applyBackendPreset(id: DevBackendEndpointId) {
    setBackendUrlOverride(devBackendSessionOverrideForPreset(id));
    setCleared(true);
    window.location.reload();
  }

  function handleUseHosted() {
    applyBackendPreset("hosted");
  }

  return (
    <div
      className={`figma-hub-fallback-banner figma-hub-fallback-banner--info${source === "local" ? " figma-hub-fallback-banner--warn" : ""}`}
      role="status"
    >
      <span>
        {backendSourceCaption(backendUrl)}
        {sessionOverride ? ` - session override active` : null}
        {envLocalDefault ? ` - .env.development.local sets local API` : null}
        {source !== "hosted" ? (
          <strong className="figma-hub-backend-banner__sample-limited">
            {" "}
            Sample limited — {source === "local" ? "local" : "custom"} backend
          </strong>
        ) : null}
      </span>
      {source === "local" ? (
        <span>
          {" "}
          Local Streamclone stack has a tiny IRC pool - use hosted API for the
          two-VPS corpus and IRC worker plane.
        </span>
      ) : source === "custom" ? (
        <span>
          {" "}
          Custom API endpoints may have a smaller IRC pool — trends and ranks are not representative of hosted production.
        </span>
      ) : null}
      <span className="figma-hub-backend-banner__actions">
        {import.meta.env.DEV ? (
          <span className="figma-hub-backend-banner__presets" role="group" aria-label="Dev API endpoint">
            {DEV_BACKEND_ENDPOINTS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`figma-hub-backend-banner__btn${activePreset === preset.id ? " figma-hub-backend-banner__btn--active" : ""}`}
                title={preset.description}
                aria-pressed={activePreset === preset.id}
                onClick={() => applyBackendPreset(preset.id)}
              >
                {preset.shortLabel}
              </button>
            ))}
          </span>
        ) : null}
        {!import.meta.env.DEV && (sessionOverride || source !== "hosted") ? (
          <button
            type="button"
            className="figma-hub-backend-banner__btn"
            onClick={handleUseHosted}
          >
            Use hosted API
          </button>
        ) : null}
        <span className="figma-hub-backend-banner__host" title={backendUrl}>
          {host}
        </span>
        {source !== "hosted" ? (
          <span className="figma-hub-backend-banner__hint">
            ({DEFAULT_PRODUCTION_BACKEND_URL})
          </span>
        ) : null}
      </span>
    </div>
  );
}
