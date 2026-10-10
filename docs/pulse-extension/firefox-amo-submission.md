# StreamPulse for Firefox — AMO submission and source build

How the Firefox package is built, what addons.mozilla.org (AMO) needs with it,
and how a reviewer rebuilds the exact files from source. Companion to
[`release.md`](./release.md) and the Chrome Web Store listing doc; the listing
text, single purpose and permission reasons are the same for every store.

Nothing here authorizes an upload. The owner uploads and submits.

---

## The Firefox package

| Item | Value |
|------|-------|
| Build | `npm run package:firefox` (build, zip, validate in one step) |
| Output | `streampulse-extension-firefox-<version>.zip` plus `.sha256` and `.validation.json` |
| Manifest | `manifests/firefox.json` (MV3) |
| Add-on ID | `streampulse@streampulse.stream` (`browser_specific_settings.gecko.id`; never change it after the first listing) |
| Minimum Firefox | `140.0` desktop (`strict_min_version`; the built-in data-collection consent needs 140) |
| Firefox for Android | Not supported. Leave **Firefox for Android** unchecked on upload; AMO's linter warns that Android needs 142 for the data-collection key, which only matters for an Android listing |
| Background | `background.scripts` + `type: "module"` (an event page). Chrome and Edge use `background.service_worker` with the same file |
| Permissions | `storage`, `scripting`; the same host list as Chrome and Edge; no `identity` while Twitch sign-in is off; no optional localhost hosts |
| Data collection | `data_collection_permissions.required: ["browsingActivity"]`: opening a Twitch channel or VOD sends its identifiers to `api.streampulse.stream` |

`package:firefox` refuses a version whose `src/shared/release-notes.json` entry is
not `"released"` with a `releasedAt` date, the same as the other store targets.
Build the upload from the release commit only.

### Firefox-specific behavior

- Extension pages use `moz-extension://<per-profile UUID>/`; message sender
  checks accept that scheme with the stable Gecko add-on ID.
- Firefox has no manual update check, so Settings > Updates hides **Check now**;
  updates come from AMO.
- Analytics and diagnostics would also need Firefox's own
  `technicalAndInteraction` consent (`src/shared/firefoxDataConsent.ts`). Both
  uploads are compiled off in this release (their toggles are hidden), so the
  manifest declares only `browsingActivity`. Turning either on later needs
  `"optional": ["technicalAndInteraction"]` in the manifest first, or Firefox
  refuses the runtime request.
- Firefox grants the listed host permissions at install (shown in the install
  prompt), but people can switch an add-on's site access off later in
  `about:addons`; the panel then has no Twitch access until it is switched back on.

### Data collection: open owner decision

The Chrome privacy answers for 0.2.2 also cover two opt-in paths: the
invited-tester device link (an opaque device credential) and bookmarks and
history saved to a linked account. Firefox's manifest declares only
`browsingActivity`. Before the first AMO upload, decide one of:

- keep the device link out of Firefox builds for 0.2.2, so `browsingActivity`
  stays the whole truth; or
- declare the linked-account data as optional Firefox data collection
  (for example `authenticationInfo`, `websiteActivity`) and request it with
  `permissions.request({ data_collection })` before linking, as
  `src/shared/firefoxDataConsent.ts` already does for technical data.

`scripts/validate-extension-package.mjs` pins the current declaration, so either
change updates that check in the same commit.

### Verified on 2026-10-10 (Firefox 157.0.1, Windows)

From #75 at `7aadb044`, packaged in a scratch copy with a scratch-only release
date: `package:firefox` and validation pass; AMO's `addons-linter` 10.14 reports
0 errors; `test:e2e:firefox` passes; on public Twitch pages a live channel, a
VOD and an offline channel load the panel and its stylesheet, the live chart and
the VOD recap with Top Moments draw, quick settings opens with the Supporter
card stage (the lazily injected `content/supporter-card.js`), and the panel and
popup links open `streampulse.stream/analytics…`, `/discord` and the settings host.

---

## Source code submission

AMO asks for source when the package holds minified or bundled code. The
package is built with Vite (Rolldown) and minified with Terser, so **answer Yes**
and upload a source archive with every version.

### Make the source archive

The build stamps the commit into the bundles (`dev-<12-char commit>-clean`) and
writes a build provenance record, both from git. A plain `git archive` has no
`.git`, so its build would differ and stop at the provenance step. Upload a
shallow clone that keeps `.git` instead:

```bash
# From any machine with git: the release tag or the exact release commit.
git clone --depth 1 --branch <release-tag> https://github.com/Aron-Chu/streamclone-pulse.git streamclone-pulse-<version>-source
cd streamclone-pulse-<version>-source
git status --porcelain   # must print nothing
cd ..
zip -qr streamclone-pulse-<version>-source.zip streamclone-pulse-<version>-source
```

Do not add `node_modules`, `dist` or ZIPs to the archive. The repository is
public, so the archive holds nothing private; still run a quick look for stray
files before uploading.

### Build instructions for the reviewer (paste into "Notes to reviewer")

```text
Build environment: any OS with Node.js 22.12 or newer (tested: Node 22.22.2 / npm 10.9.7
on Ubuntu 24.04, and Node 24.15.0 on Windows 11), npm, and git on PATH.

1. Unzip the source archive and cd into streamclone-pulse-<version>-source
   (it is a git checkout; the build reads the commit id from .git).
2. npm ci
3. npm run package:firefox
4. The add-on files are in dist/ and zipped as
   streampulse-extension-firefox-<version>.zip.

All dependencies come from package-lock.json. The build does not download
anything else. Bundling: Vite 8 (Rolldown); minification: Terser.
Readable sources: src/ (extension), packages/pulse-core and packages/pulse-charts
(in-repo libraries).
```

The build is byte-reproducible: on 2026-10-10 a Windows build and an Ubuntu
(WSL) build of the same commit produced identical `dist/` files (all 22 files,
same SHA-256), and a second Windows build from a fresh shallow clone matched too.

### Reviewer notes worth including

- `content/twitch.js` is the only declared content script (Twitch pages only).
  It renders the panel in a closed shadow root and never changes Twitch chat.
- `content/supporter-card.js` is a packaged file the background injects with
  `scripting.executeScript({ files })` into the Twitch tab only while the
  quick-settings Supporter card is open. It is not remote code.
- The background reads Twitch's own page state with
  `scripting.executeScript({ world: "MAIN", func })` to find the current
  stream and VOD ids; the functions are bundled, and their results are only ids.
- The `innerHTML` warnings from AMO's linter are React DOM internals and one
  crest SVG built from fixed constants (`src/supporter/kit.ts`); no page or
  server text reaches `innerHTML`.
- No remote code, `eval` or `new Function`. Network calls go to
  `api.streampulse.stream` and the emote image CDNs in `host_permissions`.

---

## Before each Firefox upload

1. Release commit sets the version `"released"` with its date (same commit as Chrome and Edge).
2. `npm run package:firefox` passes on that commit.
3. `npm run test:e2e:firefox` passes against that ZIP (installs it in Firefox and opens Settings, the popup and a background message). Set `GECKODRIVER_PORT` to pin geckodriver to a free port; if the first run fails with "Process unexpectedly closed with status 0", Firefox was most likely applying an update on launch (seen once on 2026-10-10); run it again.
4. AMO linter clean of errors: `npx addons-linter streampulse-extension-firefox-<version>.zip`.
5. Source archive made from the same commit as above.

## Twitch sign-in later

Firefox needs `identity` in `manifests/firefox.json` and a Twitch redirect URL
for Firefox's own redirect host, which comes from the Gecko add-on ID
(`browser.identity.getRedirectURL()`, `https://<hash>.extensions.allizom.org/`).
Register that URL with the Twitch application before a Firefox build ships
sign-in; it is different from the Chrome and Edge redirects.
