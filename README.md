# MoTrend frontend

Status reconciled 2026-09-20 against local repositories and bounded read-only
cloud metadata. Application behavior and Firebase Hosting releases were not
rerun in this docs-only refresh.

This repository is the active static frontend for `trend.moads.agency`, not an obsolete copy and not the complete MoTrend system. Its production public root is `public/`. The backend (jobs, tasks, auth/session, wallet, billing, provider orchestration, sharing and download preparation) lives in `../moads-platform`.

Production Hosting belongs to project `gen-lang-client-0651837818`; dev frontend site is `moads-trend-dev` in that same project. The separate project `motrend-dev` is not this current dev Hosting site and returned `DELETE_REQUESTED` on 2026-09-20 after an owner-authorized 2026-09-11 deletion request. Do not restore or reuse it from this repository.

See `../moads-platform/docs/platform-current-state.md` and `../moads-platform/docs/environment-contours.md` for runtime ownership. `TECHNICAL_OVERVIEW.md` and `PAYMENT_MODULE_INTEGRATION_SPEC.md` contain historical architecture/provider instructions; do not use them to recreate legacy Functions or configure FastSpring without reconciliation.

For agent work, start with `AGENTS.md`, this README and only the relevant
frontend files. The Antigravity portfolio handoff lives in the sibling platform
repository at `../moads-platform/docs/antigravity-handoff/`.

Do not delete/migrate this repo or deploy the platform's placeholder Hosting config over its frontend. No authenticated payment/provider flow was retested during the docs audit.
