# Deterministic control-matrix fixtures (reduced)

Full captures are held outside merge-ready patches.
Fixture stream IDs are for local tests only — never invent production VOD IDs.

| Control | Login | Stream ID | Files |
|---------|-------|-----------|-------|
| A offline/stale | xqc | 320567744986 | `games.json` (7 segments, id=0), `status.json` |
| B healthy live | nmplol | 319549121886 | `games.json` (1 segment), `status.json`, `emotes.catalog.json` (partial/lowConfidence empty) |

Volatile titles and full minute series are omitted from these reduced fixtures.
