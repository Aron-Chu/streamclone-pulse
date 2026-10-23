# npm audit disposition: vite dev server on the 0.2.2 release branch (2026-10)

**Scope:** branch `release/ext-0.2.2-candidate-20261022` only. Not for master.
Master has the real fix: #145 moved vite to 8.1.6 and the nested vite to 7.3.7.

**Expires:** when 0.2.2 ships or this branch is retired, whichever comes first.
Do not forward-port this disposition to master.

## Why a disposition, not the bump

The branch holds the tested 0.2.2 candidate. Its store files were checked
file for file against that candidate. Bumping vite changes the minifier, so
every shipped JS file would change and the comparison and the Chrome pass
would have to be redone. The disposition keeps the tested bytes.

## What npm audit reports

Both locks (root `streamclone-pulse` and `streampulse-web`) report one high
package entry, `vite`, with the same three locked installs:

| Locked install | Version | Lock flag |
|---|---|---|
| `node_modules/vite` | 8.0.16 | `dev: true` |
| `node_modules/vite-node/node_modules/vite` | 7.3.6 | `dev: true` |
| `node_modules/vitest/node_modules/vite` | 7.3.6 | `dev: true` |

The entry's `via` holds ten records: five advisories, each for the 7.x range
(`>=7.0.0 <=7.3.6`) and the 8.x range (`>=8.0.0 <=8.1.5`).

| Advisory | Severity | npm sources (7.x / 8.x) | Where it lives |
|---|---|---|---|
| [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | high | 1242659 / 1242660 | launch-editor, `fs.existsSync()` check on Windows |
| [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | moderate | 1242623 / 1242624 | launch-editor, `%` escaping on Windows |
| [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) | moderate | 1242652 / 1242653 | launch-editor, editor CLI flags |
| [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) | moderate | 1242731 / 1242732 | dev server, files outside `server.fs.allow` |
| [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) | low | 1242725 / 1242726 | dev server, custom middleware |

## Disposition: dev server only, not shipped

1. **Where the code runs:** all five advisories are in the vite dev server
   (its open-in-editor handler, its file server, its middleware). They need a
   running `vite` dev server or vitest. Store builds run `vite build` only.
2. **Shipped files:** the cws, edge and firefox probe packages built from this
   branch contain no launch-editor, open-in-editor, `server.fs` or dev-client
   code. The only vite code in them is the dynamic-import preload helper
   (`__vite__mapDeps`, `vite:preloadError`) that vite writes into every build.
3. **Lock flags:** every affected install is `dev: true` in both locks.

## CI enforcement

`scripts/ci-portal-npm-audit-disposition.mjs` (`auditHasExactViteDevServerAdvisories`)
accepts the `vite` entry only when all of these hold:

- the lock is the root or `streampulse-web` lock;
- the entry is `high` (not `critical`);
- its `nodes` are exactly the three installs above, each `dev: true` at the
  listed version;
- its `via` is exactly the ten records above, matched on source, title, URL,
  severity and range, with none extra, missing or repeated.

Anything else, including a new vite advisory or a changed version, fails the
gate. The root and portal audit steps both run this script and its self-test.

## Removing it

Delete the vite entry, `VITE_DEV_SERVER_*` and
`auditHasExactViteDevServerAdvisories`, the self-test block and
`scripts/fixtures/npm-audit-vite-dev-server.json`, then this file.
