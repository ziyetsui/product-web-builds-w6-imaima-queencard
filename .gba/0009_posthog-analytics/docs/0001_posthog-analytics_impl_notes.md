# PostHog analytics implementation notes

The integration follows PostHog's Next.js 15.3+ guidance and uses
`instrumentation-client.ts`. The project token remains a deployment variable;
it is not committed to the repository.

Local verification on 2026-08-04 loaded `/prompts`, after which the PostHog
onboarding screen reported `Installation complete` for project `541790`.
