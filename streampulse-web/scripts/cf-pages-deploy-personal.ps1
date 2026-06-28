# Deploy StreamPulse portal to personal Pages (production for apex streampulse.stream).
$ErrorActionPreference = 'Stop'
$env:CLOUDFLARE_ACCOUNT_ID = '51dd8007b22ac92482388d8b6cdbb6e3'
$env:VITE_BACKEND_URL = 'https://api.streampulse.stream'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  npx wrangler pages deploy dist --project-name=streampulse-web --branch=master --commit-dirty=true
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
