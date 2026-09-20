# MoTrend frontend instructions

Communicate in Russian. Start at repo root with pwd, git rev-parse --show-toplevel, git branch --show-current and git status --short. Read README.md; preserve pre-existing changes.

Scope: static consumer frontend in public/ and its Hosting configuration. Shared runtime/API/DB/auth/wallet/billing/tasks belong in ../moads-platform. Do not treat this repository as obsolete or move it without approval.

The dev Hosting site `moads-trend-dev` belongs to the platform project; it is not the separate project `motrend-dev`, whose lifecycle state was `DELETE_REQUESTED` on 2026-09-20. Do not restore or reuse the retired project. Verify explicit target/config before any authorized cloud operation; do not switch ambient project/account.

Use targeted checks and git diff --check. Do not read secret values or run real payments/provider jobs as UI tests. Shared behavior changes require cross-product impact review. Commit, push and deploy only when requested, with exact scoped paths and clean verified release code.

Historical specs describe old implementation intent, not current authority. Update current status only from verified facts; keep useful historical requirements separately.
