# imaima queencard Code Review

## Metadata

- Workflow: `w6`
- Project path: `w6/ima ima queencard/`
- Source tasks: `specs/w6/0007-imaima-queencard-implementation-tasks.md`
- Review date: 2026-06-14
- Artifact role: `code-review`
- Status: review complete with deployment blockers

## Summary

The core stop-the-bleeding implementation is in good shape locally. Automated
tests, lint, and production build pass after adding the Stripe-first billing
path, email-first auth behavior, admin credit guard, external generation bridge
contract, and Drizzle baseline migration.

Production handoff is not fully complete because the current Zeabur project
does not contain a deployment that clearly matches the local `ima ima
queencard` project.

## Findings

### P1 - Zeabur production target is ambiguous

Evidence:

```text
Current Zeabur project: goya-ai
Likely frontend service: goya-ai-corry
Service domain: goya-ai.zeabur.app
Deployment repo: ziyeprompttheworld/goya-aivideo-generator
Deployed title: Goya.ai
```

Impact:

The service appears to be an older Goya deployment, not the current local app.
I did not update variables, restart, or redeploy it because that could affect
the wrong production service.

Recommendation:

Select or create the actual `imaima queencard` Zeabur frontend service before
running T077-T081.

### P1 - Zeabur Email is account-ready but not wired to the likely frontend service

Evidence:

```text
ZSend status: healthy
imaimaqueencard.com: verified
send_only key exists: imaima-queencard-production
Likely frontend service lacks EMAIL_PROVIDER, ZEABUR_EMAIL_API_KEY, ZEABUR_EMAIL_FROM
```

Impact:

The app code supports Zeabur Email/ZSend, but the existing likely frontend
service is still configured with Resend-style keys and is not a verified
Zeabur email auth deployment.

Recommendation:

After selecting the correct service, set Zeabur env vars in Zeabur only, then
restart/redeploy and smoke `/login` and `/register` with a real mailbox.

### P2 - Full visual smoke remains incomplete

Evidence:

```text
HTTP smoke passed for /, /prompts, /pricing, /login, /register, /credits.
Desktop screenshots exist for /, /prompts, /pricing.
Mobile screenshots could not be captured in this environment.
```

Impact:

There is enough evidence that routes build and respond, but the full
desktop/mobile visual matrix is not complete.

Recommendation:

Run a stable browser smoke pass after the deployment target is selected.

## Verification

```text
pnpm test           passed: 10 files / 42 tests
pnpm run lint       passed
pnpm run build:prod passed
```

## Changed Areas

- Test framework and coverage for env flags, billing, auth, admin guard, Stripe
  webhooks, and prompt bridge.
- Stripe-first checkout/portal/webhook handling.
- Email-first login/register behavior with optional Google.
- Production guard for admin credit API.
- External generation bridge metadata.
- Drizzle initial migration baseline.
- README and env/deployment documentation.

## Remaining Work

- Pick or create the real Zeabur frontend service for `imaima queencard`.
- Configure production/preview env vars in Zeabur.
- Restart/redeploy that service.
- Smoke `/login` and `/register` magic links on the real Zeabur URL.
- Complete mobile and full desktop visual smoke.
