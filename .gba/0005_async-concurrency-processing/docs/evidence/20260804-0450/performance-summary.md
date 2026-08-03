# Performance and acceptance summary

The 1,000-task, 8-worker disposable PostgreSQL run passed every enforced zero-tolerance and concurrency gate.

| Gate | Result | Limit |
| --- | ---: | ---: |
| Global concurrent provider calls | 2 | ≤ 4 |
| Per-user concurrent calls | 1 | ≤ 1 |
| Per-provider/model concurrent calls | 2 | ≤ 2 |
| Successful claim latency P95 | 63.12 ms | < 100 ms |
| Oldest runnable wait | 3,143 ms | < 10,000 ms |
| Duplicate assets | 0 | 0 |
| Duplicate settlements | 0 | 0 |
| Inconsistent credit holds | 0 | 0 |
| Permanently stuck tasks | 0 | 0 |
| Live permits after completion | 0 | 0 |

The production build completed successfully. Better Auth emitted warnings because no production secret was injected into the local build shell; deployment must provide `BETTER_AUTH_SECRET`.
