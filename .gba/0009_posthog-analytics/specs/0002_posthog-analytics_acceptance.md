# PostHog analytics acceptance

- [x] The application builds when no PostHog token is configured.
- [x] The browser SDK initializes only when `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` exists.
- [x] Events are sent to `https://us.i.posthog.com` by default.
- [x] A local `/prompts` visit is received by PostHog project `541790`.
- [ ] The production Zeabur service has both public environment variables.
- [ ] The deployed production site sends an event to project `541790`.
