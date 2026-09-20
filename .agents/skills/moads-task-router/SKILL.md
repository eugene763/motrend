---
name: moads-task-router
description: Resolves frontend scope, backend dependencies, documentation, and risk tier for MoTrend tasks.
---

# MoTrend Task Router

Use this skill at the beginning of any MoTrend frontend task.

## Routing Protocol

1. **Scope Verification**:
   - Scope is the static consumer frontend in `public/` and Firebase Hosting config.
   - Shared runtime/API/DB/auth/wallet/billing belong to `moads-platform`.

2. **Load Canonical Docs**:
   - Technical overview: `TECHNICAL_OVERVIEW.md`
   - Payment module spec: `PAYMENT_MODULE_INTEGRATION_SPEC.md`
   - Working rules: `AGENTS.md`

3. **Risk Tier Assessment**:
   - **Tier 1**: UI styling, static text, asset updates.
   - **Tier 2**: Client-side API integration logic, state management.
   - **Tier 3**: Payment flow integration, auth token handling, hosting route changes.

## Output Contract

Return a routing summary:
- **Target Component**: [UI component / Hosting config]
- **Backend Dependency**: [moads-platform service]
- **Risk Tier**: [Tier 1 / 2 / 3]
- **Proposed Local Checks**: [Link / Browser / Layout checks]
