/**
 * CWS screenshot capture from the shipping extension dist (mocked fixtures).
 *
 * Shots:
 *   01 — live overview (tabs + CTA + Live now + Games); ends before Stream activity
 *   02 — Stream activity chart through complete Plot on chart control
 *   03 — duo: left overview (01 crop) + right chart (02 crop)
 *   04 — duo: chart + Most Reacted section
 *   05 — offline Stream Recap (real product surface)
 *
 * Usage:
 *   node scripts/capture-cws-pulse-screenshot.mjs
 *   node scripts/capture-cws-pulse-screenshot.mjs --shot=01
 *   node scripts/capture-cws-pulse-screenshot.mjs --shot=02,03,04,05
 *   node scripts/capture-cws-pulse-screenshot.mjs --shot=closeout   # 02,03,04,05
 *   node scripts/capture-cws-pulse-screenshot.mjs --package-build-commit=<40-hex> --shot=all
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (!process.execArgv.some(a => a.includes('experimental-strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', ...process.argv.slice(1)],
    { stdio: 'inherit', cwd: root, env: process.env },
  )
  process.exit(r.status ?? 1)
}

const outDir = path.join(root, 'docs/pulse-extension/cws-screenshots')
const sourcesDir = path.join(outDir, 'sources')

const CANVAS_W = 1280
const CANVAS_H = 800
const PANEL_CSS_W = 520
const DEVICE_SCALE = 2
const TARGET_PANEL_W = 660
const VIEWPORT = { width: 1920, height: 1200 }
const BG = '12, 14, 18'

function parsePackageBuildCommit() {
  const arg = process.argv.find(a => a.startsWith('--package-build-commit='))
  const value = arg?.slice('--package-build-commit='.length).trim()
  if (!value || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error('capture requires --package-build-commit=<40-hex commit>')
  }
  return value.toLowerCase()
}

const PACKAGE_BUILD_COMMIT = parsePackageBuildCommit()

const ALL_SHOTS = ['01', '02', '03', '04', '05']
const CAPTURE_INPUTS = [
  'src',
  'public',
  'manifest.json',
  'vite.config.ts',
  'package.json',
  'package-lock.json',
  'scripts/capture-cws-pulse-screenshot.mjs',
  'scripts/write-extension-build-provenance.mjs',
  'tests/e2e/fixtures/api/pulse-offline.json',
  'tests/e2e/helpers',
]

function parseShots() {
  const arg = process.argv.find(a => a.startsWith('--shot='))
  if (!arg) return ['01']
  const raw = arg.slice('--shot='.length).trim()
  if (raw === 'all') return [...ALL_SHOTS]
  if (raw === 'closeout') return ['02', '03', '04', '05']
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

async function loadHelper(rel) {
  return import(pathToFileURL(path.join(root, rel)).href)
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
      walkFiles(full, out)
    } else out.push(full)
  }
  return out
}

function assertPackageBuildInputs() {
  const result = spawnSync(
    'git',
    ['diff', '--quiet', PACKAGE_BUILD_COMMIT, '--', ...CAPTURE_INPUTS],
    { cwd: root, encoding: 'utf8' },
  )
  if (result.status === 1) {
    throw new Error(
      `capture inputs differ from PACKAGE_BUILD_COMMIT ${PACKAGE_BUILD_COMMIT}; `
      + 'use a clean checkout at that commit and its packaging dist',
    )
  }
  if (result.status !== 0) {
    throw new Error(`could not verify PACKAGE_BUILD_COMMIT: ${result.stderr || result.stdout}`)
  }
}

function assertBuildProvenance() {
  const provenancePath = path.join(root, '.artifacts/extension-build-provenance.json')
  if (!fs.existsSync(provenancePath)) {
    throw new Error(`missing ${provenancePath}; run npm run build from PACKAGE_BUILD_COMMIT`)
  }
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'))
  if (provenance.packageBuildCommit !== PACKAGE_BUILD_COMMIT) {
    throw new Error(
      `dist provenance is for ${provenance.packageBuildCommit}, expected ${PACKAGE_BUILD_COMMIT}`,
    )
  }
  const expectedFiles = Object.entries(provenance.files ?? {})
  if (expectedFiles.length === 0) throw new Error('build provenance contains no dist files')
  const actualFiles = walkFiles(path.join(root, 'dist'))
    .map(filePath => path.relative(path.join(root, 'dist'), filePath).replaceAll('\\', '/'))
    .sort()
  const expectedPaths = expectedFiles.map(([rel]) => rel).sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedPaths)) {
    throw new Error('dist file set changed after build')
  }
  for (const [rel, expected] of expectedFiles) {
    const filePath = path.join(root, 'dist', rel)
    if (!fs.existsSync(filePath)) throw new Error(`provenance file missing from dist: ${rel}`)
    const actual = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    if (actual !== expected) throw new Error(`dist hash changed after build: ${rel}`)
  }
}

function ensureFreshDist() {
  const distManifest = path.join(root, 'dist/manifest.json')
  const sourceRoots = [
    path.join(root, 'src'),
    path.join(root, 'public'),
    path.join(root, 'manifest.json'),
    path.join(root, 'vite.config.ts'),
    path.join(root, 'package.json'),
  ]
  const sources = []
  for (const p of sourceRoots) {
    if (!fs.existsSync(p)) continue
    const st = fs.statSync(p)
    if (st.isDirectory()) walkFiles(p, sources)
    else sources.push(p)
  }

  const contentJs = path.join(root, 'dist/content/twitch.js')
  if (!fs.existsSync(distManifest) || !fs.existsSync(contentJs)) {
    throw new Error(`dist/ missing; build it from PACKAGE_BUILD_COMMIT ${PACKAGE_BUILD_COMMIT}`)
  }

  const distMtime = fs.statSync(distManifest).mtimeMs
  const newer = sources.filter(f => fs.statSync(f).mtimeMs > distMtime + 1)
  if (newer.length > 0) {
    const sample = newer.slice(0, 6).map(f => path.relative(root, f)).join(', ')
    throw new Error(
      `stale dist/: ${newer.length} newer sources (${sample}); `
      + `rebuild only from PACKAGE_BUILD_COMMIT ${PACKAGE_BUILD_COMMIT}`,
    )
  } else {
    console.log('dist/ is fresh')
  }
}

function readPngMeta(filePath) {
  const buf = fs.readFileSync(filePath)
  if (buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${filePath} is not a PNG`)
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  }
}

function assertStorePng(filePath) {
  const meta = readPngMeta(filePath)
  if (meta.width !== CANVAS_W || meta.height !== CANVAS_H) {
    throw new Error(`${filePath}: size ${meta.width}x${meta.height}`)
  }
  if (meta.colorType !== 2) throw new Error(`${filePath}: colorType=${meta.colorType} (need RGB)`)
  if (meta.bitDepth !== 8) throw new Error(`${filePath}: bitDepth=${meta.bitDepth}`)
  return meta
}

function gitIdentity() {
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' })
  const branch = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' })
  return `${(head.stdout || '').trim()} (${(branch.stdout || '').trim() || 'detached'})`
}

async function widenPanel(page, panelW) {
  await page.evaluate(w => {
    const style = document.createElement('style')
    style.id = 'cws-capture-widen'
    style.textContent = `
      #streamclone-pulse-chat-fixture {
        width: ${w}px !important; right: 0 !important; left: auto !important;
        top: 0 !important; height: 100vh !important;
      }
      #streamclone-pulse-tabs, #streamclone-pulse-root {
        width: ${w}px !important; right: 0 !important; left: auto !important;
      }
      #streamclone-pulse-root, #streamclone-pulse-root * { scrollbar-width: none !important; }
    `
    document.getElementById('cws-capture-widen')?.remove()
    document.head.appendChild(style)
    const fixture = document.getElementById('streamclone-pulse-chat-fixture')
    if (fixture) {
      fixture.style.width = `${w}px`
      fixture.style.right = '0'
      fixture.style.left = 'auto'
    }
  }, panelW)
}

async function clickPulseTab(page) {
  await page.evaluate(() => {
    const tabs = document.getElementById('streamclone-pulse-tabs')
    const root = tabs?.shadowRoot ?? tabs
    const buttons = root ? [...(root.querySelectorAll?.('button') ?? [])] : []
    buttons.find(b => /pulse/i.test(b.textContent ?? ''))?.click?.()
  })
}

async function scrollPanelToProgress(page, progress) {
  await page.evaluate(p => {
    const host = document.getElementById('streamclone-pulse-root')
    const body = host?.shadowRoot?.querySelector('.pulse-panel-body')
    if (!body) return
    const max = Math.max(0, body.scrollHeight - body.clientHeight)
    body.scrollTop = Math.round(max * p)
  }, progress)
}

async function scrollElementIntoPanelView(page, findKind) {
  await page.evaluate(kind => {
    const host = document.getElementById('streamclone-pulse-root')
    const shadow = host?.shadowRoot
    const body = shadow?.querySelector('.pulse-panel-body')
    if (!shadow || !body) return
    let el = null
    if (kind === 'stream-activity') {
      const nodes = [...shadow.querySelectorAll('div, span, section')]
      el = nodes.find(n => {
        const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim()
        return /^stream activity$/i.test(t) || (t.length < 40 && /^stream activity/i.test(t))
      })
    } else if (kind === 'plot') {
      el = shadow.querySelector('.pulse-seven-tv-panel')
    } else if (kind === 'recap') {
      const nodes = [...shadow.querySelectorAll('div, section, h2, span')]
      el = nodes.find(n => /stream recap|last stream recap/i.test((n.textContent ?? '').trim()) && (n.textContent ?? '').length < 40)
    } else if (kind === 'games') {
      el = shadow.querySelector('[aria-label="Games played"]')
    }
    if (!el) return
    const er = el.getBoundingClientRect()
    const br = body.getBoundingClientRect()
    const delta = er.top - br.top - 12
    body.scrollTop += delta
  }, findKind)
}

/** Measure CSS crop relative to panel left/top (tabs∪root). */
async function measureCrop(page, mode) {
  return page.evaluate(m => {
    const tabsHost = document.getElementById('streamclone-pulse-tabs')
    const rootHost = document.getElementById('streamclone-pulse-root')
    if (!tabsHost || !rootHost?.shadowRoot) return { error: 'missing hosts' }
    const shadow = rootHost.shadowRoot
    const tabsBox = tabsHost.getBoundingClientRect()
    const rootBox = rootHost.getBoundingClientRect()
    const left = Math.min(tabsBox.left, rootBox.left)
    const right = Math.max(tabsBox.right, rootBox.right)
    const panelTop = Math.min(tabsBox.top, rootBox.top)

    const findText = (re, maxLen = 80) => {
      const nodes = [...shadow.querySelectorAll('div, span, section, button, p, h2, small')]
      for (const el of nodes) {
        const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (re.test(t) && t.length <= maxLen) return el
      }
      return null
    }

    const gamesEl = shadow.querySelector('[aria-label="Games played"]') ?? findText(/games played/i)
    const activityEl = findText(/^stream activity$/i, 40) ?? findText(/stream activity/i, 40)
    const plotEl = shadow.querySelector('.pulse-seven-tv-panel')
    const legendEl = shadow.querySelector('[aria-label="Chart series legend"]')
    const recapTitle = findText(/^stream recap$/i, 30) ?? findText(/last stream recap/i, 40)

    const hubText = shadow.textContent ?? ''
    const legendText = legendEl?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    const shipping = {
      hasHubSubtitle: /Full history, tracked channels, and deeper analytics/i.test(hubText),
      legendText,
      // Shadow textContent concatenates chip labels without spaces.
      hasFiveLegend:
        /Viewers/i.test(legendText)
        && /Emotes/i.test(legendText)
        && /Chat trend/i.test(legendText)
        && /Emote trend/i.test(legendText)
        && (legendText.match(/Chat/gi) || []).length >= 2,
    }

    let top = panelTop
    let bottom = Math.max(tabsBox.bottom, rootBox.bottom)

    if (m === 'overview') {
      if (!gamesEl || !activityEl) return { error: 'overview needs Games played + Stream activity', shipping }
      const gamesBox = gamesEl.getBoundingClientRect()
      const activityBox = activityEl.getBoundingClientRect()
      bottom = Math.min(activityBox.top - 2, Math.max(gamesBox.bottom + 4, activityBox.top - 8))
      if (bottom >= activityBox.top - 0.5) bottom = activityBox.top - 2
      if (gamesBox.bottom > bottom + 0.5) return { error: 'Games played would be clipped', shipping }
    } else if (m === 'chart') {
      if (!activityEl || !plotEl) return { error: 'chart needs Stream activity + Plot on chart', shipping }
      const activityBox = activityEl.getBoundingClientRect()
      const plotBox = plotEl.getBoundingClientRect()
      // Prefer starting at Games played when visible above chart; else activity header.
      if (gamesEl) {
        const gb = gamesEl.getBoundingClientRect()
        if (gb.top >= panelTop - 1 && gb.bottom <= activityBox.top + 40) {
          top = Math.min(gb.top - 8, activityBox.top - 4)
        } else {
          top = activityBox.top - 4
        }
      } else {
        top = activityBox.top - 4
      }
      bottom = plotBox.bottom + 8
      if (plotBox.bottom > bottom + 0.5) return { error: 'Plot on chart clipped', shipping }
      if (activityBox.top < top - 0.5) return { error: 'Stream activity header clipped at top', shipping }
    } else if (m === 'moments') {
      const momentsTitle =
        findText(/most reacted so far/i, 220) ?? findText(/most reacted/i, 220)
      if (!momentsTitle) return { error: 'Most reacted section not found', shipping }
      let card = momentsTitle
      let best = null
      for (let i = 0; i < 12 && card; i++) {
        const t = (card.textContent ?? '').replace(/\s+/g, ' ')
        const r = card.getBoundingClientRect()
        if (
          /most reacted so far/i.test(t)
          && !/stream activity/i.test(t)
          && !/live now/i.test(t)
          && r.height >= 120
          && r.height < 720
          && r.width > 200
        ) {
          best = card
          // Prefer the largest matching card under the cap (section vs tiny title).
        }
        card = card.parentElement
      }
      if (!best) return { error: 'Most reacted card boundary not found', shipping }
      const box = best.getBoundingClientRect()
      top = Math.max(0, box.top - 4)
      bottom = Math.min(box.bottom + 8, window.innerHeight - 8)
      if (bottom - top < 120) return { error: 'moments crop too short', shipping }
    } else if (m === 'recap') {
      if (!recapTitle) return { error: 'Stream Recap title not found', shipping }
      let card = recapTitle
      for (let i = 0; i < 8 && card.parentElement; i++) {
        card = card.parentElement
        const r = card.getBoundingClientRect()
        if (r.height > 200 && r.width > 200) break
      }
      const box = card.getBoundingClientRect()
      top = Math.min(panelTop, box.top - 4)
      if (Math.abs(box.top - panelTop) < 160) top = panelTop

      // Prefer a clean in-viewport section end (never clip mid-card off-screen).
      const candidates = []
      const pushIf = (el, label) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        if (r.bottom > top + 80 && r.bottom <= window.innerHeight - 8) {
          candidates.push({ bottom: r.bottom, label })
        }
      }
      pushIf(findText(/^top emotes this stream$/i, 40), 'top-emotes')
      pushIf(findText(/^top moments$/i, 30), 'top-moments')
      pushIf(findText(/^selected moment$/i, 30), 'selected')
      pushIf(findText(/^stream activity$/i, 40), 'activity-header-only-skip')
      // Games played inside recap
      pushIf(shadow.querySelector('[aria-label="Games played"]'), 'games')
      // Timeline chart svg parent
      const svg = shadow.querySelector('svg[aria-label="Stream overview chart"], svg')
      if (svg) pushIf(svg.parentElement, 'chart')

      const usable = candidates
        .filter(c => c.label !== 'activity-header-only-skip')
        .sort((a, b) => a.bottom - b.bottom)

      // Prefer the deepest section that still fits a 560px-wide downsample into 800px canvas.
      // At DPR=2 and cssW≈520 → rawW≈1040; max cssH ≈ (760 * 1040) / (560 * 2) ≈ 705.
      const maxCssH = 680
      const fitting = usable.filter(c => c.bottom - top <= maxCssH)
      if (fitting.length > 0) {
        bottom = fitting[fitting.length - 1].bottom + 8
      } else if (usable.length > 0) {
        bottom = Math.min(usable[0].bottom + 8, top + maxCssH)
      } else {
        bottom = Math.min(box.bottom + 4, top + maxCssH, window.innerHeight - 8)
      }
      if (bottom > window.innerHeight - 4) bottom = window.innerHeight - 8
      if (bottom - top < 240) {
        return { error: `recap visible crop too short (${bottom - top}px)`, shipping }
      }
    } else {
      return { error: `unknown mode ${m}`, shipping }
    }

    const width = right - left
    const height = bottom - top
    const overflows =
      left < -0.5 || top < -0.5 || right > window.innerWidth + 0.5 || bottom > window.innerHeight + 0.5

    return {
      error: null,
      shipping,
      css: {
        x: left,
        y: top,
        width,
        height,
        vw: window.innerWidth,
        vh: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
        overflowsViewport: overflows,
      },
    }
  }, mode)
}

async function captureClip(page, css, rawPath, { minHeight = 200 } = {}) {
  if (css.overflowsViewport) throw new Error(`crop overflows viewport: ${JSON.stringify(css)}`)
  if (css.width < 300 || css.height < minHeight) {
    throw new Error(`crop too small: ${JSON.stringify(css)}`)
  }
  const clip = {
    x: Math.floor(css.x),
    y: Math.floor(css.y),
    width: Math.ceil(css.width),
    height: Math.ceil(css.height),
  }
  await page.screenshot({ path: rawPath, type: 'png', clip, scale: 'device' })
  const rawMeta = readPngMeta(rawPath)
  if (rawMeta.colorType === 6) throw new Error('raw has alpha')
  return { clip, rawMeta }
}

function composeSingle(srcPath, destPath, targetPanelW) {
  const srcEsc = srcPath.replace(/'/g, "''")
  const destEsc = destPath.replace(/'/g, "''")
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile('${srcEsc}')
try {
  $targetW = ${targetPanelW}
  if ($src.Width -lt $targetW) { throw "refuse upscale: $($src.Width) < $targetW" }
  $scale = $targetW / [double]$src.Width
  $dw = [int][Math]::Round($src.Width * $scale)
  $dh = [int][Math]::Round($src.Height * $scale)
  if ($dw -lt 560 -or $dw -gt 680) { throw "panel width $dw outside 560-680" }
  if ($dh -gt (${CANVAS_H} - 20)) { throw "panel height $dh too tall for canvas" }
  $bmp = New-Object System.Drawing.Bitmap ${CANVAS_W}, ${CANVAS_H}, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.Clear([System.Drawing.Color]::FromArgb(${BG}))
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $x = [int]((${CANVAS_W} - $dw) / 2)
    $y = [int]((${CANVAS_H} - $dh) / 2)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle $x,$y,$dw,$dh), (New-Object System.Drawing.Rectangle 0,0,$src.Width,$src.Height), [System.Drawing.GraphicsUnit]::Pixel)
  } finally { $g.Dispose() }
  $bmp.Save('${destEsc}', [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host ("COMPOSE panel={0}x{1} scale={2:N4} src={3}x{4}" -f $dw,$dh,$scale,$src.Width,$src.Height)
  $bmp.Dispose()
} finally { $src.Dispose() }
`
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', cwd: root })
  if (r.status !== 0) throw new Error(`compose failed: ${r.stderr || r.stdout}`)
  process.stdout.write(r.stdout || '')
  return assertStorePng(destPath)
}

function composeDuo(leftPath, rightPath, destPath) {
  const leftEsc = leftPath.replace(/'/g, "''")
  const rightEsc = rightPath.replace(/'/g, "''")
  const destEsc = destPath.replace(/'/g, "''")
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$left = [System.Drawing.Bitmap]::FromFile('${leftEsc}')
$right = [System.Drawing.Bitmap]::FromFile('${rightEsc}')
try {
  $gap = 28
  $sidePad = 36
  $topPad = 28
  $availW = ${CANVAS_W} - (2 * $sidePad) - $gap
  $availH = ${CANVAS_H} - (2 * $topPad)
  $scaleL = [Math]::Min(($availW / 2.0) / $left.Width, $availH / [double]$left.Height)
  $scaleR = [Math]::Min(($availW / 2.0) / $right.Width, $availH / [double]$right.Height)
  $scale = [Math]::Min($scaleL, $scaleR)
  if ($scale -ge 1.0) { throw "refuse upscale duo scale=$scale" }
  $lw = [int][Math]::Round($left.Width * $scale)
  $lh = [int][Math]::Round($left.Height * $scale)
  $rw = [int][Math]::Round($right.Width * $scale)
  $rh = [int][Math]::Round($right.Height * $scale)
  $totalW = $lw + $gap + $rw
  $totalH = [Math]::Max($lh, $rh)
  $bmp = New-Object System.Drawing.Bitmap ${CANVAS_W}, ${CANVAS_H}, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.Clear([System.Drawing.Color]::FromArgb(${BG}))
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $ox = [int]((${CANVAS_W} - $totalW) / 2)
    $oy = [int]((${CANVAS_H} - $totalH) / 2)
    $g.DrawImage($left, (New-Object System.Drawing.Rectangle $ox,$oy,$lw,$lh), (New-Object System.Drawing.Rectangle 0,0,$left.Width,$left.Height), [System.Drawing.GraphicsUnit]::Pixel)
    $g.DrawImage($right, (New-Object System.Drawing.Rectangle ($ox+$lw+$gap),$oy,$rw,$rh), (New-Object System.Drawing.Rectangle 0,0,$right.Width,$right.Height), [System.Drawing.GraphicsUnit]::Pixel)
  } finally { $g.Dispose() }
  $bmp.Save('${destEsc}', [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host ("COMPOSE_DUO L={0}x{1} R={2}x{3} scale={4:N4}" -f $lw,$lh,$rw,$rh,$scale)
  $bmp.Dispose()
} finally { $left.Dispose(); $right.Dispose() }
`
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', cwd: root })
  if (r.status !== 0) throw new Error(`duo compose failed: ${r.stderr || r.stdout}`)
  process.stdout.write(r.stdout || '')
  return assertStorePng(destPath)
}

async function launchLiveSession(helpers) {
  const {
    launchExtensionContext,
    seedExtensionStorage,
    installMockApi,
    installTwitchFixtures,
    openTwitchChannel,
    waitForPulseRoot,
    assertPulseShadowContains,
    simulateSidebarSnap,
    dismissTwitchOverlays,
  } = helpers

  const launched = await launchExtensionContext({
    headless: false,
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
  })
  const api = await installMockApi(launched.context, 'live-ready')
  await installTwitchFixtures(launched.context, {
    kind: 'live',
    login: 'fixturechan',
    vodId: '2806037629',
  })
  await seedExtensionStorage(launched.serviceWorker, {
    overlayMode: 'expanded',
    overlayPlacement: 'sidebar',
    sidebarTab: 'pulse',
    defaultChartWindow: 'full',
    defaultChartWindowMigratedToFullV1: true,
    themePreference: 'aurora',
  })
  await openTwitchChannel(launched.page)
  await dismissTwitchOverlays(launched.page)
  await simulateSidebarSnap(launched.page)
  await widenPanel(launched.page, PANEL_CSS_W)
  await waitForPulseRoot(launched.page)
  await assertPulseShadowContains(launched.page, /Open Analytics Hub/i)
  await assertPulseShadowContains(launched.page, /Full history, tracked channels, and deeper analytics/i)
  await assertPulseShadowContains(launched.page, /Stream activity/i)
  await assertPulseShadowContains(launched.page, /Chat trend/i)
  await assertPulseShadowContains(launched.page, /Emote trend/i)
  await clickPulseTab(launched.page)
  await launched.page.waitForFunction(() => {
    const t = document.getElementById('streamclone-pulse-root')?.shadowRoot?.textContent ?? ''
    return /Live now/i.test(t) && /Games played/i.test(t) && /Stream activity/i.test(t)
  })
  return { launched, api }
}

async function launchOfflineSession(helpers) {
  const {
    launchExtensionContext,
    seedExtensionStorage,
    installMockApi,
    installTwitchFixtures,
    openTwitchChannel,
    waitForPulseRoot,
    assertPulseShadowContains,
    simulateSidebarSnap,
    dismissTwitchOverlays,
  } = helpers

  const launched = await launchExtensionContext({
    headless: false,
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
  })
  const api = await installMockApi(launched.context, 'offline')
  await installTwitchFixtures(launched.context, {
    kind: 'offline',
    login: 'fixturechan',
    vodId: '2806037629',
  })
  await seedExtensionStorage(launched.serviceWorker, {
    overlayMode: 'expanded',
    overlayPlacement: 'sidebar',
    sidebarTab: 'pulse',
    defaultChartWindow: 'full',
    defaultChartWindowMigratedToFullV1: true,
    themePreference: 'aurora',
  })
  await openTwitchChannel(launched.page)
  await dismissTwitchOverlays(launched.page)
  await simulateSidebarSnap(launched.page)
  await widenPanel(launched.page, PANEL_CSS_W)
  await waitForPulseRoot(launched.page)
  await clickPulseTab(launched.page)
  await assertPulseShadowContains(launched.page, /Stream Recap|Last Stream Recap/i)
  return { launched, api }
}

async function shot01(helpers, identity) {
  const { launched, api } = await launchLiveSession(helpers)
  try {
    await scrollPanelToProgress(launched.page, 0)
    const geo = await measureCrop(launched.page, 'overview')
    if (geo.error) throw new Error(`01: ${geo.error}`)
    if (!geo.shipping.hasHubSubtitle || !geo.shipping.hasFiveLegend) {
      throw new Error(`01 shipping mismatch: ${JSON.stringify(geo.shipping)}`)
    }
    const rawPath = path.join(sourcesDir, '01-playwright-pulse-panel-raw.png')
    const { clip, rawMeta } = await captureClip(launched.page, geo.css, rawPath)
    const outPath = path.join(outDir, '01-live-pulse-panel-1280x800.png')
    composeSingle(rawPath, outPath, TARGET_PANEL_W)
    const meta = { shot: '01', identity, cropStory: 'overview before Stream activity', clip, rawMeta, shipping: geo.shipping, css: geo.css }
    fs.writeFileSync(path.join(sourcesDir, '01-capture-meta.json'), JSON.stringify(meta, null, 2))
    console.log('Wrote', outPath)
  } finally {
    await api.dispose()
    await helpers.closeExtensionContext(launched, { retainVideoDir: false })
  }
}

async function shot02(helpers, identity) {
  const { launched, api } = await launchLiveSession(helpers)
  try {
    await scrollElementIntoPanelView(launched.page, 'games')
    await scrollElementIntoPanelView(launched.page, 'stream-activity')
    // Nudge so plot control is fully visible
    await scrollElementIntoPanelView(launched.page, 'plot')
    const geo = await measureCrop(launched.page, 'chart')
    if (geo.error) throw new Error(`02: ${geo.error}`)
    if (!geo.shipping.hasFiveLegend) throw new Error(`02 legend mismatch: ${geo.shipping.legendText}`)
    const rawPath = path.join(sourcesDir, '02-playwright-stream-activity-raw.png')
    const { clip, rawMeta } = await captureClip(launched.page, geo.css, rawPath)
    // Chart crops are taller — allow slightly narrower panel if needed to fit height
    let targetW = TARGET_PANEL_W
    const scaleProbe = targetW / rawMeta.width
    const destH = Math.round(rawMeta.height * scaleProbe)
    if (destH > CANVAS_H - 24) {
      targetW = Math.max(560, Math.floor((rawMeta.width * (CANVAS_H - 40)) / rawMeta.height))
      console.log(`02: reducing target width to ${targetW} to fit height`)
    }
    const outPath = path.join(outDir, '02-stream-activity-chart-1280x800.png')
    composeSingle(rawPath, outPath, targetW)
    const meta = { shot: '02', identity, cropStory: 'games/activity through Plot on chart', clip, rawMeta, targetW, shipping: geo.shipping, css: geo.css }
    fs.writeFileSync(path.join(sourcesDir, '02-capture-meta.json'), JSON.stringify(meta, null, 2))
    console.log('Wrote', outPath)
  } finally {
    await api.dispose()
    await helpers.closeExtensionContext(launched, { retainVideoDir: false })
  }
}

async function shot03(helpers, identity) {
  const { launched, api } = await launchLiveSession(helpers)
  try {
    await scrollPanelToProgress(launched.page, 0)
    const leftGeo = await measureCrop(launched.page, 'overview')
    if (leftGeo.error) throw new Error(`03-left: ${leftGeo.error}`)
    if (!leftGeo.shipping.hasHubSubtitle || !leftGeo.shipping.hasFiveLegend) {
      throw new Error(`03 shipping mismatch: ${JSON.stringify(leftGeo.shipping)}`)
    }
    const leftRaw = path.join(sourcesDir, '03-playwright-duo-left-raw.png')
    await captureClip(launched.page, leftGeo.css, leftRaw)

    await scrollElementIntoPanelView(launched.page, 'stream-activity')
    await scrollElementIntoPanelView(launched.page, 'plot')
    const rightGeo = await measureCrop(launched.page, 'chart')
    if (rightGeo.error) throw new Error(`03-right: ${rightGeo.error}`)
    const rightRaw = path.join(sourcesDir, '03-playwright-duo-right-raw.png')
    await captureClip(launched.page, rightGeo.css, rightRaw)

    const outPath = path.join(outDir, '03-pulse-duo-1280x800.png')
    composeDuo(leftRaw, rightRaw, outPath)
    const meta = {
      shot: '03',
      identity,
      cropStory: 'duo overview + full chart',
      left: leftGeo.css,
      right: rightGeo.css,
      shipping: leftGeo.shipping,
    }
    fs.writeFileSync(path.join(sourcesDir, '03-capture-meta.json'), JSON.stringify(meta, null, 2))
    console.log('Wrote', outPath)
  } finally {
    await api.dispose()
    await helpers.closeExtensionContext(launched, { retainVideoDir: false })
  }
}

async function shot04(helpers, identity) {
  const { launched, api } = await launchLiveSession(helpers)
  try {
    await scrollElementIntoPanelView(launched.page, 'stream-activity')
    await scrollElementIntoPanelView(launched.page, 'plot')
    const leftGeo = await measureCrop(launched.page, 'chart')
    if (leftGeo.error) throw new Error(`04-left: ${leftGeo.error}`)
    if (!leftGeo.shipping.hasFiveLegend) {
      throw new Error(`04 legend mismatch: ${leftGeo.shipping.legendText}`)
    }
    const leftRaw = path.join(sourcesDir, '04-playwright-moments-left-raw.png')
    await captureClip(launched.page, leftGeo.css, leftRaw)

    await launched.page.evaluate(() => {
      const host = document.getElementById('streamclone-pulse-root')
      const shadow = host?.shadowRoot
      const body = shadow?.querySelector('.pulse-panel-body')
      if (!shadow || !body) return
      body.scrollTop = body.scrollHeight
    })
    await helpers.assertPulseShadowContains(launched.page, /Most Reacted So Far/i)
    const rightCss = await launched.page.evaluate(() => {
      const host = document.getElementById('streamclone-pulse-root')
      const shadow = host?.shadowRoot
      if (!shadow) return { error: 'no shadow' }
      const section = [...shadow.querySelectorAll('section')].find(n => {
        const t = (n.textContent ?? '').replace(/\s+/g, ' ')
        return /most reacted so far/i.test(t) && !/live now/i.test(t) && !/stream activity/i.test(t)
      })
      if (!section) return { error: 'Most reacted section missing' }
      section.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = section.getBoundingClientRect()
      if (r.height < 100) return { error: `section too short ${r.height}` }
      if (r.top < -1 || r.bottom > window.innerHeight + 1) {
        return { error: `section not in viewport top=${r.top} bottom=${r.bottom}` }
      }
      return {
        error: null,
        css: {
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          vw: window.innerWidth,
          vh: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
          overflowsViewport: false,
        },
      }
    })
    if (rightCss.error) throw new Error(`04-right: ${rightCss.error}`)
    const rightRaw = path.join(sourcesDir, '04-playwright-moments-right-raw.png')
    await captureClip(launched.page, rightCss.css, rightRaw, { minHeight: 100 })

    const outPath = path.join(outDir, '04-moments-and-chart-1280x800.png')
    composeDuo(leftRaw, rightRaw, outPath)
    const meta = {
      shot: '04',
      identity,
      cropStory: 'duo chart + Most Reacted section only',
      left: leftGeo.css,
      right: rightCss.css,
      shipping: leftGeo.shipping,
    }
    fs.writeFileSync(path.join(sourcesDir, '04-capture-meta.json'), JSON.stringify(meta, null, 2))
    console.log('Wrote', outPath)
  } finally {
    await api.dispose()
    await helpers.closeExtensionContext(launched, { retainVideoDir: false })
  }
}

async function shot05(helpers, identity) {
  const { launched, api } = await launchOfflineSession(helpers)
  try {
    // Pin Stream Recap near the top of the scrollable panel body.
    await launched.page.evaluate(() => {
      const host = document.getElementById('streamclone-pulse-root')
      const shadow = host?.shadowRoot
      const body = shadow?.querySelector('.pulse-panel-body')
      if (!shadow || !body) return
      const nodes = [...shadow.querySelectorAll('div, section, h2, span')]
      const title = nodes.find(n => {
        const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim()
        return /^(stream recap|last stream recap)$/i.test(t)
      })
      if (!title) return
      const er = title.getBoundingClientRect()
      const br = body.getBoundingClientRect()
      body.scrollTop += er.top - br.top - 8
    })
    const geo = await measureCrop(launched.page, 'recap')
    if (geo.error) throw new Error(`05: ${geo.error}`)
    const rawPath = path.join(sourcesDir, '05-playwright-stream-recap-raw.png')
    const { clip, rawMeta } = await captureClip(launched.page, geo.css, rawPath)
    let targetW = TARGET_PANEL_W
    const scaleProbe = targetW / rawMeta.width
    const destH = Math.round(rawMeta.height * scaleProbe)
    if (destH > CANVAS_H - 24) {
      targetW = Math.max(560, Math.floor((rawMeta.width * (CANVAS_H - 40)) / rawMeta.height))
      console.log(`05: reducing target width to ${targetW} to fit height`)
    }
    const outPath = path.join(outDir, '05-stream-recap-1280x800.png')
    composeSingle(rawPath, outPath, targetW)
    const meta = { shot: '05', identity, cropStory: 'Stream Recap in-viewport clean section', clip, rawMeta, targetW, css: geo.css }
    fs.writeFileSync(path.join(sourcesDir, '05-capture-meta.json'), JSON.stringify(meta, null, 2))
    console.log('Wrote', outPath)
  } finally {
    await api.dispose()
    await helpers.closeExtensionContext(launched, { retainVideoDir: false })
  }
}

async function main() {
  const shots = parseShots()
  for (const s of shots) {
    if (!ALL_SHOTS.includes(s)) throw new Error(`unknown shot ${s}`)
  }
  if (process.platform !== 'win32') {
    throw new Error('CWS screenshot composition requires Windows PowerShell and System.Drawing')
  }
  assertPackageBuildInputs()
  assertBuildProvenance()
  ensureFreshDist()
  fs.mkdirSync(sourcesDir, { recursive: true })
  const identity = gitIdentity()
  console.log('Capture identity', identity, 'shots', shots.join(','))

  const { launchExtensionContext, closeExtensionContext, seedExtensionStorage } =
    await loadHelper('tests/e2e/helpers/extensionContext.ts')
  const { installMockApi } = await loadHelper('tests/e2e/helpers/mockApi.ts')
  const { installTwitchFixtures, openTwitchChannel } = await loadHelper(
    'tests/e2e/helpers/mockTwitch.ts',
  )
  const { waitForPulseRoot, assertPulseShadowContains } = await loadHelper(
    'tests/e2e/helpers/assertions.ts',
  )
  const { simulateSidebarSnap, dismissTwitchOverlays } = await loadHelper(
    'tests/e2e/helpers/goldenCapture.ts',
  )
  const helpers = {
    launchExtensionContext,
    closeExtensionContext,
    seedExtensionStorage,
    installMockApi,
    installTwitchFixtures,
    openTwitchChannel,
    waitForPulseRoot,
    assertPulseShadowContains,
    simulateSidebarSnap,
    dismissTwitchOverlays,
  }

  for (const shot of shots) {
    if (shot === '01') await shot01(helpers, identity)
    else if (shot === '02') await shot02(helpers, identity)
    else if (shot === '03') await shot03(helpers, identity)
    else if (shot === '04') await shot04(helpers, identity)
    else if (shot === '05') await shot05(helpers, identity)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
