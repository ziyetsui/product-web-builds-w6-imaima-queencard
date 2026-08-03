# Task 4 Report

## Status

Complete. The mini-program now consumes a versioned normalized catalog from the
latest verified Web source and keeps the existing Queencard vertical UI shape.

## Catalog Snapshot

- Source ref and commit: `027d145`
- Source inputs:
  - `web/imaima-queencard/frontend/src/data/boLandingPromptCases.ts`: 2,155
    records
  - `web/imaima-queencard/frontend/src/data/xhsPromptCases.ts`: 122 records
  - `web/imaima-queencard/frontend/src/data/xhsCaseMetrics.ts`: XHS potential
    score/rank enrichment by note id
- Snapshot: `backend/catalog/catalog.snapshot.json`
- Schema: `backend/catalog/schema.json`, schema version `1`
- Catalog version: `catalog-027d145-52723ad48bb9db16`
- SHA-256 checksum:
  `52723ad48bb9db16dab055bb1406f8bab2189f407d0924a67ada931e688276fc`
- Union count before deduplication: 2,277
- Final records: 2,277
- Exact duplicate IDs removed: 0
- Source counts: BO 2,155; XHS 122
- Required category counts: 爆款图文 332; 梗图 1,000; 公众号配图 823
- BO asset references: 5,642 total, 2,919 local, 2,723 HTTP, 0 missing
- XHS asset references: 1,063 total, 1,063 local, 0 HTTP, 0 missing

The builder accepts explicit source paths or `git-ref:path` inputs, records the
source metadata and checksum, and rejects invalid records, conflicting duplicate
IDs, invalid dates/metrics, or missing local assets. HTTP references remain URLs;
no catalog image binaries are bundled into `app/`.

## Runtime Behavior

- Memory, SQLite, and PostgreSQL adapters implement version creation, import,
  active-version switching, listing, and detail lookup through the store
  contract. Imports validate before switching and write/switch transactionally.
- API responses include `catalogVersion`, server category counts, the
  `热门高赞` special filter count, tag/keyword filtering, and page/cursor
  pagination.
- `default` and `hot` use Web hot ordering (`likes + saves`); `latest` uses
  date order; `potential` uses potential score, potential rank, then weighted
  interactions. `热门高赞` keeps the Web predicate `likes >= 20000 OR saves >=
  20000`.
- The client caches pages under the returned catalog version, aborts pending
  requests, ignores stale responses, renders server facets/counts, and supports
  loading, empty, error, retry, and infinite-pagination states.

## TDD And Verification

Focused red tests were added before implementation for builder validation,
duplicate conflicts, asset failures, Web sort semantics, transactional import,
all store adapters, API pagination, stale client requests, cancellation, and
server-record field preservation.

Commands and results:

- `cd backend && npm test`: 135 passed, 0 failed, 1 skipped because
  `DATABASE_URL_TEST` is not configured.
- `cd app && npm run validate`: passed, 9 app tests, 55-file validation.
- `cd backend && npm audit --omit=dev`: 0 vulnerabilities.
- `node --check` passed for `app/`, `backend/src/`, `backend/scripts/`, and
  `backend/test/` JavaScript files.
- Snapshot builder run twice to `/tmp/ima-catalog-a.json` and
  `/tmp/ima-catalog-b.json`; `cmp` returned success and both produced the
  checksum above.
- Snapshot count/asset audit and default API smoke test passed.
- `git diff --check`: passed.

## Concerns

- Real PostgreSQL integration remains unexecuted until `DATABASE_URL_TEST` is
  supplied; pg-mem adapter coverage passed.
- WeChat Developer Tools visual review and a live deployed API check were not
  available in this checkout.
