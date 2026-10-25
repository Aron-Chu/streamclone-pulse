# Local headed Firefox harness

Use this harness to establish a Selenium/geckodriver session against the installed
desktop Firefox. It creates a disposable profile and installs the current
Firefox-target extension temporarily. It does not attach to a personal profile.

The default `setup` mode visits only a local deterministic fixture. It proves the
driver, temporary add-on lifecycle, page-log capture, screenshot output and
closed-shadow access capability. It does **not** complete real Twitch checks or
turn an existing BLOCKED result into PASS.

The older `test:e2e:firefox` command remains a separate headless settings/popup
test. This harness uses no privileged browser context, `--allow-system-access`,
custom profile or browser security preference changes.

## Prepare a local artifact

Prerequisites: Node.js 24 or newer, the repository's locked dependencies and an
installed desktop Firefox. Use a separate worktree of the intended extension
commit. `npm ci` supplies the existing Selenium, yauzl and yazl dependencies if
dependencies are not already present.

The browser-free lifecycle unit tests use injected drivers and run on the
repository's Node.js 22 CI baseline. The Node.js 24 requirement is enforced at
the real Firefox driver boundary before Selenium or the browser is launched.

Run from that worktree in PowerShell, choosing new output directories:

```powershell
$env:EXTENSION_TARGET = 'firefox'
$env:PULSE_EXTENSION_TWITCH_SIGNIN = 'off'
Remove-Item Env:PULSE_SUPPORTER_DEV_ORIGIN -ErrorAction SilentlyContinue
npm run ensure:packages
npm run build
node scripts/prepare-firefox-local-artifact.mjs --out C:/local-evidence/firefox-artifact
```

The preparation helper requires the exact Firefox manifest, stages legal notices,
refreshes local provenance and creates a ZIP whose name ends in `local-only.zip`.
It reads the actual ZIP back, compares every packaged file to the dist/provenance
hashes and verifies its manifest, Firefox target and runtime build marker.
`artifact-verification.json` records the ZIP's SHA-256, source revision and
verification results. The runner rehashes the ZIP before launching Firefox.

Local harness ZIPs intentionally contain `extension-target.json`. Store ZIPs
normally omit that local metadata. This helper does not run the store package
validator and does not change the unreleased release-notes gate. These artifacts
are not for upload. Use the normal release procedure for store packages.

## Run the setup smoke

```powershell
node scripts/run-extension-live-firefox.mjs `
  --artifact C:/local-evidence/firefox-artifact/artifact-verification.json `
  --firefox 'C:/Program Files/Mozilla Firefox/firefox.exe' `
  --evidence C:/local-evidence/firefox-setup `
  --mode setup
```

The browser is headed. Do not sign in or interact with the test window during the
short deterministic smoke. Selenium Manager may download geckodriver on the first
run. The runner disables Manager usage statistics and browser downloads and uses
the explicit installed Firefox executable. Record the resolved driver version;
set `GECKODRIVER_BINARY` to that cached executable when pinning the driver for
subsequent runs. The harness records that path and the runtime driver version.

Evidence stays in the chosen local directory. Keep screenshots, logs and profile
paths out of public reports and uploads. A setup result must distinguish actual
driver/install failures, an unsupported closed-shadow operation and cleanup
errors. Successful browser closure alone does not establish add-on removal.

## Finite real-Twitch acceptance

The acceptance command runs the public-page checks and then cleans up without
an interactive stdin controller or a manual pause:

```powershell
node scripts/run-extension-acceptance-firefox.mjs `
  --artifact C:/local-evidence/firefox-artifact/artifact-verification.json `
  --firefox 'C:/Program Files/Mozilla Firefox/firefox.exe' `
  --evidence C:/local-evidence/firefox-acceptance `
  --url https://www.twitch.tv/caedrel `
  --vod-url https://www.twitch.tv/videos/2902672687
```

It records temporary load/runtime identity, the approximately three-minute live
observation, clip isolation and return, live card-to-row picture sharing, finished
VOD pictures and exact-ID cleanup. Each run uses a new evidence directory and
leaves historical run 7 and D1 records alone.

Exit codes distinguish the result: `0` means all requested checks passed, `1`
means a failure, and `2` means the assessment completed with a declared BLOCKED
check. In the ordinary web-content-only Firefox context, actual runtime
permission/consent inspection remains BLOCKED. A finite exit `2` is different
from an idle controller that requires interruption.

Required screenshots must be unique. Capture exhaustion blocks the affected
check; failed file, hash or assignment audits fail the run.

The harness refuses an inherited privileged system-access environment. Neither
profile metadata nor the declared manifest is promoted to full runtime-grant
proof. Firefox's public extension metadata can corroborate identity and removal;
it does not expose a complete permission/consent snapshot in this context.

## Legacy live probe and inspection limits

The older setup runner's optional `live` mode is an initial identity/visibility probe. Consult
`--help` for its options. It is not the complete timed Firefox acceptance suite.
Only the explicit live mode visits Twitch; no authentication, Track, watchlist,
feedback, chat, follow or subscription action belongs in this workflow.

Before claiming live extension coverage, establish all of:

- The packaged build ID and Firefox target match the visible runtime host.
- The expected owner, a visible styled panel and its stylesheet are present.
- Host permissions are actually granted, rather than merely declared.
- CHAT/MIN observations include actual elapsed times near 0, 90 and 180 seconds.
- A real shared clip has no Pulse panel, including after ordinary same-tab
  navigation, and the panel returns on the live channel.
- Real scene pictures are distinguished from artwork, with a card-to-existing-row
  handoff observed for the cache fix. Image dimensions alone do not prove that.
- Content and background errors are inspected with their source and time.

Keep a manual Firefox DevTools checkpoint for granted permissions/data-collection
consent and extension background logs. Ordinary Twitch page JavaScript cannot
call `browser.permissions.getAll()` for this extension. Run that read-only query
in the extension's own toolbox if needed. Close the toolbox before timed testing,
since it can keep the event page alive. BiDi page logs do not prove background
log coverage.

Do not change the production closed shadow mode to make tests pass. The setup
fixture probes the installed browser's WebDriver shadow-root support separately.
If unsupported, record that limit and use an explicitly documented observation
method for any later live readings.

Existing run 7 Firefox rows and D1 store skips remain unchanged by setup. Formal
retesting is a separate recorded run against its identified artifact.

## On the 0.2.2 release branch

0.2.2 keeps Moment pictures to frames its own tab played
(`src/content/momentFrames.ts`). It has no exact VOD frames and no Twitch picture
lookups, which arrive in 0.2.3. The `pictures-live-row` and `pictures-vod` extras
wait for a "Twitch VOD frame" card and for pictures of moments the tab never
played, so a 0.2.2 build is not expected to pass them. Record them as not
applicable to 0.2.2, never as PASS. Judge 0.2.2 pictures by
`tests/momentFramesLocal.test.ts` and an observed check of frames the tab played.

## Official references

- [Firefox functionality in Selenium](https://www.selenium.dev/documentation/webdriver/browsers/firefox/)
- [Selenium Manager configuration](https://www.selenium.dev/documentation/selenium_manager/)
- [geckodriver disposable profiles](https://firefox-source-docs.mozilla.org/testing/geckodriver/Profiles.html)
