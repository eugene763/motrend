# Project execution contract for MoTrend Frontend

Communicate in Russian; code/comments/technical docs in English.
Before work, identify cwd, Git root, branch and dirty state. Read root and scoped
AGENTS.md, README.md, preserve symlinks and pre-existing edits.
Use canonical task-specific docs (`TECHNICAL_OVERVIEW.md`, `PAYMENT_MODULE_INTEGRATION_SPEC.md`); historical plans do not authorize execution.
Before edits state product, environment, files, impact and checks.
Default to local work. Metadata audits use explicit project targets (`--project=gen-lang-client-0651837818`).
Never read, print, copy or commit secret values, .env contents, private keys, tokens, cookies or unrelated customer data. Do not alter ambient cloud config.
Local work does not authorize commit/push, deployment, IAM/API/DNS/billing, secret changes, data mutation or real leads/payments/provider jobs/conversions.
Do not enable APIs or reauthenticate merely to complete an audit.
Honor existing exact authorization; ask only for a new material decision/risk.
Inspect -> diagnose -> narrow implementation -> scoped checks -> report.
Run git diff --check; report failed and skipped checks honestly.
Do not switch branches, reset/clean/rebase/merge, or stage broadly.

MoTrend invariants:
- Static consumer frontend resides in `public/` and Firebase Hosting config.
- Backend API, DB, Auth, and Cloud Tasks belong to `moads-platform`.
- Dev Hosting target `moads-trend-dev` belongs to `gen-lang-client-0651837818`, NOT `motrend-dev` (retired project).
- Never restore or attempt to deploy to retired project `motrend-dev`.
- Do not run real payment tests or provider jobs as part of UI verification.
