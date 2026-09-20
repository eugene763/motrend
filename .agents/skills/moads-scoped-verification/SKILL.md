---
name: moads-scoped-verification
description: Runs non-mutating layout, file, and git diff checks for MoTrend frontend changes.
---

# MoTrend Scoped Verification

Use this skill after making local changes to the MoTrend static frontend.

## Verification Protocol

1. **File & Link Integrity**:
   - Verify HTML, JS, CSS files exist and references are valid.
   - Run `git diff --check` to verify code formatting hygiene.

2. **No Real Payment / Provider Runs**:
   - Confirm no real payment calls, live API invocations, or provider jobs were triggered during verification.

## Output Contract

Return a verification report:
- **Verified Scope**: [Static frontend files]
- **Git Diff Hygiene**: [Clean / Issue details]
- **Side-Effect Audit**: [Verified local only]
