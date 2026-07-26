#!/usr/bin/env bash
# RPR-6: credential-free clean-checkout proof (CI).
# Sibling private repos and STREAMPULSE_BACKEND_CHECKOUT_TOKEN must not be required.
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
cd "${ROOT}"

# Explicitly clear the retired secret name so accidental env leakage cannot "help".
unset STREAMPULSE_BACKEND_CHECKOUT_TOKEN || true
export STREAMPULSE_BACKEND_CHECKOUT_TOKEN=""

if [[ -d "${ROOT}/../streampulse-backend/packages" ]]; then
  echo "ci-clean-checkout-proof: note — sibling streampulse-backend exists on the runner host"
  echo "ci-clean-checkout-proof: continuing; install must still use only in-repo packages/*"
fi

bash scripts/ci-verify-pulse-packages.sh

# Fail closed on escaping file: dependencies across package.json + lockfiles.
node scripts/check-public-source-readiness.mjs

# Packages must build without any backend checkout token.
npm run build:packages
npm run ensure:packages

echo "ci-clean-checkout-proof: OK (no STREAMPULSE_BACKEND_CHECKOUT_TOKEN; in-repo packages only)"
echo "ci-clean-checkout-proof: note — STREAMPULSE_BACKEND_CHECKOUT_TOKEN is retired; owner should remove the GitHub secret (this workflow does not mutate secrets)."
