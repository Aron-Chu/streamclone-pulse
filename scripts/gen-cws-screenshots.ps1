# Generates Chrome Web Store screenshot PNGs at 1280x800 from Figma handoff assets.
# Requires Windows System.Drawing. Run from repo root:
#   powershell -File scripts/gen-cws-screenshots.ps1
param(
  [string]$OutDir = "docs/pulse-extension/cws-screenshots"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$TargetW = 1280
$TargetH = 800
$Bg = [System.Drawing.Color]::FromArgb(255, 12, 14, 18)

$shots = @(
  @{ Src = "docs/pulse-extension/figma/hero-on-twitch.png"; Dest = "01-overlay-beside-chat-1280x800.png"; Caption = "Live Pulse overlay docked beside Twitch chat" }
  @{ Src = "docs/pulse-extension/figma/expanded-panel.png"; Dest = "02-expanded-pulse-panel-1280x800.png"; Caption = "Expanded StreamPulse panel" }
  @{ Src = "docs/pulse-extension/figma/settings.png"; Dest = "03-settings-panel-1280x800.png"; Caption = "StreamPulse settings" }
  @{ Src = "docs/pulse-extension/figma/state-warming-up.png"; Dest = "04-honest-warming-coverage-1280x800.png"; Caption = "Honest warming / partial coverage state" }
  @{ Src = "docs/pulse-extension/figma/stream-recap.png"; Dest = "05-stream-recap-1280x800.png"; Caption = "Stream recap moments" }
)

function Fit-Contain([System.Drawing.Image]$src, [int]$tw, [int]$th) {
  $scale = [Math]::Min($tw / [double]$src.Width, $th / [double]$src.Height)
  $nw = [int][Math]::Round($src.Width * $scale)
  $nh = [int][Math]::Round($src.Height * $scale)
  $x = [int](($tw - $nw) / 2)
  $y = [int](($th - $nh) / 2)
  return @{ W = $nw; H = $nh; X = $x; Y = $y }
}

foreach ($shot in $shots) {
  $srcPath = Join-Path $root $shot.Src
  if (-not (Test-Path $srcPath)) { throw "Missing source $($shot.Src)" }
  $src = [System.Drawing.Image]::FromFile((Resolve-Path $srcPath))
  try {
    $canvas = New-Object System.Drawing.Bitmap $TargetW, $TargetH
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $g.Clear($Bg)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $fit = Fit-Contain $src $TargetW $TargetH
      $g.DrawImage($src, $fit.X, $fit.Y, $fit.W, $fit.H)
    } finally { $g.Dispose() }
    $dest = Join-Path $OutDir $shot.Dest
    $canvas.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
    Write-Host "OK $($shot.Dest) ($($shot.Caption))"
  } finally { $src.Dispose() }
}

# Small promo tile 440x280 from 128 Peak icon (letterboxed)
$iconPath = Join-Path $root "public/icons/icon128.png"
$icon = [System.Drawing.Image]::FromFile((Resolve-Path $iconPath))
try {
  $tile = New-Object System.Drawing.Bitmap 440, 280
  $g = [System.Drawing.Graphics]::FromImage($tile)
  try {
    $g.Clear($Bg)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $fit = Fit-Contain $icon 440 280
    # Prefer a larger centered mark
    $size = [Math]::Min(180, [Math]::Min($fit.W, $fit.H))
    $x = [int]((440 - $size) / 2)
    $y = [int]((280 - $size) / 2)
    $g.DrawImage($icon, $x, $y, $size, $size)
  } finally { $g.Dispose() }
  $tilePath = Join-Path $OutDir "promo-small-tile-440x280.png"
  $tile.Save($tilePath, [System.Drawing.Imaging.ImageFormat]::Png)
  $tile.Dispose()
  Write-Host "OK promo-small-tile-440x280.png"
} finally { $icon.Dispose() }

Write-Host "Wrote store screenshots under $OutDir"
