## Summary

<!-- What changed and why? -->

## Checklist

- [ ] CI is green on this branch (or local typecheck/test/build if CI did not execute)
- [ ] No `.env`, tokens, DSNs, or secrets committed
- [ ] No production topology, SSH paths, or private ops runbooks
- [ ] Diagnostics / support / analytics claims stay truthful (default-off / planned labeled)
- [ ] `npm run typecheck` and `npm test` when extension or shared TS changed
- [ ] `npm run build` when extension sources changed
- [ ] Portal checks (`streampulse-web`) when portal UI changed
- [ ] Packaging validators when store manifests / ZIP scripts changed
- [ ] Docs updated when contacts, consent, or public-release gates changed

## Test plan

<!-- Commands run and what you verified manually -->

## RPR / release notes

<!-- Leave blank unless this touches RPR-* gates. Never mark RPR-8/9 complete here. -->
