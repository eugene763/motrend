---
name: moads-release-preflight
description: Prepares a release preflight plan for MoTrend Firebase Hosting deployments.
---

# MoTrend Release Preflight

Use this skill when preparing a deployment plan for MoTrend frontend.

## Preflight Protocol

1. **Verify Target Environment & Hosting Config**:
   - Dev Hosting target `moads-trend-dev` belongs to platform project `gen-lang-client-0651837818`.
   - Never use or attempt deployment to retired project `motrend-dev`.

2. **Commit Parity Check**:
   - Verify local Git HEAD is committed and pushed before proposing release.

3. **Rollback Plan**:
   - Document active Hosting release ID for rollback capability.

## Output Contract

Return a release plan:
- **Target Site**: [moads-trend-dev / production]
- **Target GCP Project**: [gen-lang-client-0651837818]
- **Commit HEAD**: [Git SHA]
- **Rollback Release Target**: [Release ID]
