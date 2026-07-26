/**
 * RPR-6 package-distribution acceptance: pack real npm tarballs and install
 * them into empty temporary consumers (no source aliases).
 *
 * Validates:
 *   - Node ESM imports of package main entry
 *   - TypeScript declaration consumption (tsc --noEmit)
 *   - Vite production build consuming packaged dist
 *   - React singleton (one react copy under consumer node_modules)
 *   - Every main/types/exports target (including CSS wildcards)
 */
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { PACKAGE_DIRS, auditTarballEntries } from './check-package-tarball.mjs'
import { collectRequiredExportTargets } from './ensure-packages-built.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmShell = process.platform === 'win32'

function run(cmd, args, cwd, opts = {}) {
  const bin = process.platform === 'win32' && cmd === 'npm' ? npmCmd : cmd
  const result = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx'),
    stdio: opts.stdio ?? 'pipe',
    env: opts.env ?? process.env,
  })
  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || result.error?.message || ''
    throw new Error(`${cmd} ${args.join(' ')} failed (status=${result.status}): ${detail}`)
  }
  return result
}

function listTarball(tgzPath) {
  const listed = spawnSync('tar', ['-tzf', tgzPath], { encoding: 'utf8' })
  if (listed.status !== 0) {
    throw new Error(`tar -tzf failed: ${listed.stderr || listed.stdout}`)
  }
  return listed.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * @param {string} packDir
 * @returns {Map<string, string>} package name → tarball absolute path
 */
function packAllPackages(packDir) {
  /** @type {Map<string, string>} */
  const tarballs = new Map()
  mkdirSync(packDir, { recursive: true })

  // Ensure dist exists before pack.
  run('npm', ['run', 'build:packages'], root, { stdio: 'inherit' })

  for (const pkgRel of PACKAGE_DIRS) {
    const pkgDir = join(root, pkgRel)
    const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

    if (!existsSync(join(pkgDir, 'LICENSE'))) {
      throw new Error(`missing LICENSE in ${pkgRel}`)
    }
    if (!existsSync(join(pkgDir, 'NOTICE'))) {
      throw new Error(`missing NOTICE in ${pkgRel} (NOTICE is mandatory)`)
    }

    const packed = run('npm', ['pack', '--pack-destination', packDir], pkgDir)
    const tgzName = (packed.stdout || '')
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1)
    if (!tgzName) throw new Error(`npm pack produced no tarball for ${pkgRel}`)
    const tgzPath = join(packDir, tgzName)
    const entries = listTarball(tgzPath)
    const audit = auditTarballEntries(entries)
    if (!audit.ok) {
      throw new Error(
        `tarball allowlist failed for ${pkgRel}: ${audit.violations.map((v) => v.path).join(', ')}`,
      )
    }
    const names = entries.map((e) => e.replace(/^package\//, ''))
    if (!names.includes('LICENSE')) {
      throw new Error(`${pkgRel} tarball missing LICENSE`)
    }
    if (!names.includes('NOTICE')) {
      throw new Error(`${pkgRel} tarball missing NOTICE (mandatory)`)
    }

    // Export targets must exist inside the packed tree (extracted check via tar list).
    const required = collectRequiredExportTargets(pkgDir, pkgJson)
    for (const abs of required) {
      const rel = abs.slice(pkgDir.length + 1).replace(/\\/g, '/')
      if (!names.includes(rel) && !names.includes(`package/${rel}`)) {
        // CSS/root files and dist files must be present.
        const asEntry = names.some((n) => n === rel || n.endsWith(`/${rel.split('/').pop()}`))
        if (!asEntry && !names.includes(rel)) {
          // Exact match required for known paths.
          if (!names.includes(rel)) {
            throw new Error(`${pkgRel} tarball missing export target ${rel}`)
          }
        }
      }
      if (!names.includes(rel)) {
        throw new Error(`${pkgRel} tarball missing export target ${rel}`)
      }
    }

    tarballs.set(pkgJson.name, tgzPath)
    console.log(`packed ${pkgJson.name} → ${tgzName} (${entries.length} entries)`)
  }
  return tarballs
}

function writeConsumerPackageJson(consumerDir, tarballs, extraDeps = {}) {
  const deps = {
    '@streampulse/pulse-core': tarballs.get('@streampulse/pulse-core'),
    '@streampulse/pulse-charts': tarballs.get('@streampulse/pulse-charts'),
    '@streampulse/analytics-console': tarballs.get('@streampulse/analytics-console'),
    ...extraDeps,
  }
  // file: absolute paths for local tarballs
  const fileDeps = Object.fromEntries(
    Object.entries(deps).map(([name, path]) => [name, `file:${path}`]),
  )
  writeFileSync(
    join(consumerDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'pulse-tarball-consumer',
        private: true,
        type: 'module',
        dependencies: fileDeps,
      },
      null,
      2,
    )}\n`,
  )
}

async function testNodeImports(consumerDir) {
  const core = await import(pathToFileURL(join(consumerDir, 'node_modules/@streampulse/pulse-core/dist/index.js')).href)
  if (typeof core.mergeRecapMoments !== 'function' && typeof core.formatMomentTimeLabel !== 'function') {
    // At least one known export must resolve from packaged dist.
    const keys = Object.keys(core)
    if (keys.length === 0) throw new Error('pulse-core packaged export is empty')
  }

  const chartsPkg = JSON.parse(
    readFileSync(join(consumerDir, 'node_modules/@streampulse/pulse-charts/package.json'), 'utf8'),
  )
  const cssExport = chartsPkg.exports?.['./pulse-chart-motion.css']
  if (!cssExport) throw new Error('pulse-charts missing CSS export')
  const cssPath = join(
    consumerDir,
    'node_modules/@streampulse/pulse-charts',
    String(cssExport).replace(/^\.\//, ''),
  )
  if (!existsSync(cssPath)) throw new Error(`CSS export missing on disk: ${cssPath}`)

  const consolePkg = JSON.parse(
    readFileSync(join(consumerDir, 'node_modules/@streampulse/analytics-console/package.json'), 'utf8'),
  )
  const acCss = consolePkg.exports?.['./analytics-chart-motion.css']
  if (!acCss) throw new Error('analytics-console missing CSS export')
  const acCssPath = join(
    consumerDir,
    'node_modules/@streampulse/analytics-console',
    String(acCss).replace(/^\.\//, ''),
  )
  if (!existsSync(acCssPath)) throw new Error(`analytics-console CSS missing: ${acCssPath}`)

  // Wildcard export: import a concrete subpath from packaged dist (not source).
  const coreSub = join(consumerDir, 'node_modules/@streampulse/pulse-core/dist/liveHeat.js')
  if (!existsSync(coreSub)) throw new Error('pulse-core wildcard export target dist/liveHeat.js missing')
  await import(pathToFileURL(coreSub).href)

  console.log('consumer: Node ESM imports + CSS exports OK')
}

function testTypeScriptDeclarations(consumerDir, tarballs) {
  const tsConsumer = join(consumerDir, 'ts-check')
  mkdirSync(tsConsumer, { recursive: true })
  writeFileSync(
    join(tsConsumer, 'package.json'),
    `${JSON.stringify(
      {
        name: 'pulse-ts-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@streampulse/pulse-core': `file:${tarballs.get('@streampulse/pulse-core')}`,
          typescript: '6.0.3',
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(tsConsumer, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['consume.ts'],
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(tsConsumer, 'consume.ts'),
    `import type { MomentRef } from '@streampulse/pulse-core'\n` +
      `import { mergeRecapMoments } from '@streampulse/pulse-core'\n` +
      `export const _probe: typeof mergeRecapMoments = mergeRecapMoments\n` +
      `export type _Ref = MomentRef\n`,
  )
  run('npm', ['install', '--ignore-scripts'], tsConsumer)
  run('npx', ['tsc', '-p', 'tsconfig.json'], tsConsumer)
  console.log('consumer: TypeScript declarations OK')
}

function testViteProductionBuild(consumerDir, tarballs) {
  const viteConsumer = join(consumerDir, 'vite-app')
  mkdirSync(viteConsumer, { recursive: true })
  writeFileSync(
    join(viteConsumer, 'package.json'),
    `${JSON.stringify(
      {
        name: 'pulse-vite-consumer',
        private: true,
        type: 'module',
        scripts: { build: 'vite build' },
        dependencies: {
          '@streampulse/pulse-core': `file:${tarballs.get('@streampulse/pulse-core')}`,
          '@streampulse/pulse-charts': `file:${tarballs.get('@streampulse/pulse-charts')}`,
          react: '18.3.1',
          'react-dom': '18.3.1',
        },
        devDependencies: {
          '@vitejs/plugin-react': '6.0.2',
          typescript: '6.0.3',
          vite: '8.0.16',
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(viteConsumer, 'vite.config.ts'),
    `import { defineConfig } from 'vite'\n` +
      `import react from '@vitejs/plugin-react'\n` +
      `export default defineConfig({ plugins: [react()], build: { outDir: 'dist' } })\n`,
  )
  writeFileSync(
    join(viteConsumer, 'index.html'),
    `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`,
  )
  mkdirSync(join(viteConsumer, 'src'), { recursive: true })
  writeFileSync(
    join(viteConsumer, 'src/main.tsx'),
    `import React from 'react'\n` +
      `import { createRoot } from 'react-dom/client'\n` +
      `import { mergeRecapMoments } from '@streampulse/pulse-core'\n` +
      `import '@streampulse/pulse-charts/pulse-chart-motion.css'\n` +
      `const el = document.getElementById('root')!\n` +
      `createRoot(el).render(<div>{String(typeof mergeRecapMoments)}</div>)\n`,
  )
  run('npm', ['install', '--ignore-scripts'], viteConsumer)
  assertReactSingleton(viteConsumer)
  run('npm', ['run', 'build'], viteConsumer, { stdio: 'inherit' })
  if (!existsSync(join(viteConsumer, 'dist/index.html'))) {
    throw new Error('vite production build missing dist/index.html')
  }
  console.log('consumer: Vite production build + React singleton OK')
}

function assertReactSingleton(consumerDir) {
  const reactPkg = join(consumerDir, 'node_modules/react/package.json')
  if (!existsSync(reactPkg)) throw new Error('react not installed in vite consumer')
  // Nested duplicate under a package would indicate broken singleton.
  const nested = join(consumerDir, 'node_modules/@streampulse/pulse-charts/node_modules/react')
  if (existsSync(nested)) {
    throw new Error('React singleton violated: nested react under pulse-charts')
  }
  const require = createRequire(join(consumerDir, 'package.json'))
  const resolved = require.resolve('react')
  if (!resolved.includes(`${consumerDir}${require('node:path').sep}node_modules${require('node:path').sep}react`) &&
      !resolved.replace(/\\/g, '/').includes('/node_modules/react/')) {
    throw new Error(`unexpected react resolve: ${resolved}`)
  }
}

function testAllExportTargetsOnDisk(tarballs) {
  const extractRoot = mkdtempSync(join(tmpdir(), 'pulse-tgz-extract-'))
  try {
    for (const [name, tgz] of tarballs) {
      const dest = join(extractRoot, name.replace('@', '').replace('/', '-'))
      mkdirSync(dest, { recursive: true })
      const extracted = spawnSync('tar', ['-xzf', tgz, '-C', dest], { encoding: 'utf8' })
      if (extracted.status !== 0) {
        throw new Error(`extract failed for ${name}: ${extracted.stderr}`)
      }
      const pkgRoot = join(dest, 'package')
      const pkgJson = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
      const required = collectRequiredExportTargets(pkgRoot, pkgJson)
      for (const abs of required) {
        if (!existsSync(abs)) {
          throw new Error(`${name} extracted tarball missing ${abs}`)
        }
      }
      // Refuse source-tree aliases: src may be present, but main must point at dist.
      if (!String(pkgJson.main || '').includes('dist/')) {
        throw new Error(`${name} main must point at packaged dist, got ${pkgJson.main}`)
      }
      console.log(`consumer: export targets on disk OK for ${name}`)
    }
  } finally {
    rmSync(extractRoot, { recursive: true, force: true })
  }
}

function main() {
  const nest = mkdtempSync(join(tmpdir(), 'pulse-pack-consumer-'))
  try {
    const packDir = join(nest, 'tarballs')
    const tarballs = packAllPackages(packDir)
    testAllExportTargetsOnDisk(tarballs)

    const nodeConsumer = join(nest, 'node-consumer')
    mkdirSync(nodeConsumer, { recursive: true })
    writeConsumerPackageJson(nodeConsumer, tarballs)
    run('npm', ['install', '--ignore-scripts'], nodeConsumer)
    // Async import bridge
    const importProbe = join(nodeConsumer, 'probe.mjs')
    writeFileSync(
      importProbe,
      `import { pathToFileURL } from 'node:url'\n` +
        `import { join, dirname } from 'node:path'\n` +
        `import { fileURLToPath } from 'node:url'\n` +
        `import { existsSync, readFileSync } from 'node:fs'\n` +
        `const root = dirname(fileURLToPath(import.meta.url))\n` +
        `const core = await import('@streampulse/pulse-core')\n` +
        `if (!core || typeof core !== 'object') throw new Error('pulse-core import failed')\n` +
        `const chartsPkg = JSON.parse(readFileSync(join(root,'node_modules/@streampulse/pulse-charts/package.json'),'utf8'))\n` +
        `const css = join(root,'node_modules/@streampulse/pulse-charts', String(chartsPkg.exports['./pulse-chart-motion.css']).replace(/^\\.\\//,''))\n` +
        `if (!existsSync(css)) throw new Error('css missing')\n` +
        `const acPkg = JSON.parse(readFileSync(join(root,'node_modules/@streampulse/analytics-console/package.json'),'utf8'))\n` +
        `const acCss = join(root,'node_modules/@streampulse/analytics-console', String(acPkg.exports['./analytics-chart-motion.css']).replace(/^\\.\\//,''))\n` +
        `if (!existsSync(acCss)) throw new Error('ac css missing')\n` +
        `await import('@streampulse/pulse-core/liveHeat')\n` +
        `console.log('node consumer probe ok')\n`,
    )
    run('node', [importProbe], nodeConsumer, { stdio: 'inherit' })

    testTypeScriptDeclarations(nest, tarballs)
    testViteProductionBuild(nest, tarballs)

    console.log('\ncheck-package-tarball-consumer: all consumer acceptance checks OK')
  } finally {
    rmSync(nest, { recursive: true, force: true })
  }
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('check-package-tarball-consumer.mjs')) {
  main()
}
