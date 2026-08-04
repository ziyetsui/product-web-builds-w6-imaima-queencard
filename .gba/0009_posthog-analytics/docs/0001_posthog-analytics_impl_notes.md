# PostHog analytics implementation notes

The integration follows PostHog's Next.js 15.3+ guidance and uses
`instrumentation-client.ts`. The project token remains a deployment variable;
it is not committed to the repository.

Local verification on 2026-08-04 loaded `/prompts`, after which the PostHog
onboarding screen reported `Installation complete` for project `541790`.

Production verification on 2026-08-04:

- PR `#20` merged to `main` as `39f9deb`.
- Zeabur deployment `6a71a5bf73b1b9143a623e95` reached `RUNNING`.
- `https://queencard-imaima.zeabur.app/prompts` returned HTTP 200.
- The production JavaScript bundle contained the configured project token and
  US ingestion host.
- A clean-browser production visit appeared in PostHog as `Pageview` within a
  few seconds.
