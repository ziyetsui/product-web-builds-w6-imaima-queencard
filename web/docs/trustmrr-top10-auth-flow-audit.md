# TrustMRR Top 10 Auth Flow Audit

Checked on 2026-06-13 from https://trustmrr.com/.

Screenshot folder:

`w6/product-web-builds-w6/web/docs/trustmrr-screenshots/`

Folder structure:

- `00-overview/`: TrustMRR homepage screenshot
- `01-stan/` to `10-hidden-business/`: product-specific screenshots and notes
- `_data/`: extracted JSON data from the browser audit

## Top 10 From Leaderboard

| Rank | Product | MRR | External site exposed by TrustMRR | Auth flow summary | Key screenshots |
| --- | --- | ---: | --- | --- | --- |
| 1 | Stan | $3,569,654 | Yes, `https://stan.store/?ref=trustmrr` | Public site has same-page CTAs. `Continue` redirects to `https://admin.stan.store/register?ref=trustmrr`, but the admin register page rendered blank in the automated browser, so the form could not be inspected. | `01-stan/01-stan-trustmrr.png`, `01-stan/01-stan-external-home.png`, `01-stan/01-stan-continue-click-viewport.png`, `01-stan/01-stan-register-admin-wait.png` |
| 2 | Stealth Company | $747,069 | No | Listing is stealth; no external `Visit` link exposed, so product auth flow cannot be checked from TrustMRR. | `02-stealth-company/02-stealth-company-23-trustmrr.png` |
| 3 | Unnamed Company | $366,833 | No | Anonymous listing; no external `Visit` link exposed. | `03-unnamed-company/03-unnamed-company-trustmrr.png` |
| 4 | Rezi | $271,923 | Yes, `https://www.rezi.ai/?ref=trustmrr` | Traditional email/password auth with Google OAuth. Login has email + password + forgot password. Signup has email + password + Google. | `04-rezi/04-rezi-trustmrr.png`, `04-rezi/04-rezi-external-home.png`, `04-rezi/04-rezi-login.png`, `04-rezi/04-rezi-signup.png` |
| 5 | Kibu | $234,319 | Yes, `https://kibu.com/?ref=trustmrr` | Login only is obvious. It redirects to `auth.kibu.com` and asks for email, then `Continue`. No public signup/register link found from homepage. | `05-kibu/05-kibu-trustmrr.png`, `05-kibu/05-kibu-external-home.png`, `05-kibu/05-kibu-login.png` |
| 6 | 1Lookup | $226,726 | Yes, `https://www.1lookup.io/?ref=trustmrr` | Traditional account auth. Login has email + password + remember me + Google + forgot password. Signup is multi-step: organization, first name, last name, work email, phone, password, plus Google. | `06-1lookup/06-1lookup-trustmrr.png`, `06-1lookup/06-1lookup-external-home.png`, `06-1lookup/06-1lookup-login-waited.png`, `06-1lookup/06-1lookup-signup.png` |
| 7 | Cometly | $201,453 | Yes, `https://www.cometly.com/?ref=trustmrr` | B2B-style flow. Login has email + password + remember me. Signup/get-started is a lead form: name, work email, team size, phone, website, then continue. | `07-cometly/07-cometly-trustmrr.png`, `07-cometly/07-cometly-external-home.png`, `07-cometly/07-cometly-login-loose.png`, `07-cometly/07-cometly-signup-loose.png` |
| 8 | Brand On Demand, Inc. / Supliful | $190,333 | Yes, `http://supliful.com/?ref=trustmrr` | Passwordless/social-heavy auth. Login asks email and offers Google, Facebook, X. Signup asks full name + email and offers Google, Facebook, X. | `08-supliful-brand-on-demand/08-brand-on-demand-inc-trustmrr.png`, `08-supliful-brand-on-demand/08-supliful-external-home-loose.png`, `08-supliful-brand-on-demand/08-supliful-login-loose.png`, `08-supliful-brand-on-demand/08-supliful-signup-loose.png` |
| 9 | Stealth Venture | $187,018 | No | Listing is stealth; no external `Visit` link exposed. | `09-stealth-venture/09-stealth-venture-3-trustmrr.png` |
| 10 | Hidden Business | $185,954 | No | Hidden listing; no external `Visit` link exposed. | `10-hidden-business/10-hidden-business-12-trustmrr.png` |

## Patterns Worth Copying For imaima queencard

1. Rezi and 1Lookup use the clearest conventional SaaS pattern: separate login and signup pages, explicit password fields, Google OAuth, forgot password.
2. Supliful is closer to a lightweight consumer onboarding pattern: login/signup share a visual shell, email-first, social login prominent, no password visible at the first step.
3. Kibu uses an enterprise-style email-first login, likely invite/admin controlled. This is clean but not ideal if imaima queencard needs self-serve growth.
4. Cometly uses a sales-led signup form, collecting team/company context before account creation. Useful for B2B, too heavy for imaima queencard.
5. TrustMRR top revenue products are not all self-serve. Four of the top 10 are stealth/anonymous/hidden and do not expose product onboarding at all.

For imaima queencard, the best reference is Supliful's email-first simplicity combined with Rezi's explicit "already have account / sign up" clarity.
