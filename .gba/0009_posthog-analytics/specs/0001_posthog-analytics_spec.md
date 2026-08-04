# PostHog analytics integration

## Goal

Connect the Next.js application to PostHog project `541790` on US Cloud.

## Scope

- Initialize `posthog-js` through Next.js `instrumentation-client.ts`.
- Enable the current recommended SDK defaults and browser exception capture.
- Keep the integration disabled when the public project token is absent.
- Document the two public deployment environment variables.

## Non-goals

- Server-side event capture.
- Custom product events, dashboards, experiments, or feature flags.
- Replacing the existing Enter analytics integration.
