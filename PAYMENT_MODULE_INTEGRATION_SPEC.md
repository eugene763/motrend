# MoTrend Payment Module Integration Spec

Last updated: 2026-03-30 (Asia/Tbilisi)

This document is a practical handoff spec for continuing payment integration work in a separate branch without replaying prior chat context.

## 1) Git Anchors (Local Snapshot)

### Canonical frontend repo
- Path: `/Users/malevich/Documents/Playground/motrend`
- Branch: `main`
- HEAD: `33bdbbe12d1fb758a2e8006ee0331d6a87eb2dcd`
- Status at snapshot: clean, synced with `origin/main`

### Secondary local clone (legacy/diverged)
- Path: `/Users/malevich/motrend`
- Branch: `main`
- HEAD: `ec5bee3`
- Status at snapshot: `ahead 1, behind 12` vs `origin/main`
- Important: this clone does not contain the current wallet checkout UI/API flow.

### Backend/API repo (reference for payment contracts)
- Path: `/Users/malevich/Documents/Playground/moads-platform`
- Branch: `main`
- HEAD: `cf118bed2538ab6239ba4c8dd72865c5ceee77a0`

## 2) Scope and Source of Truth

For payment module work, treat this stack as source of truth:
- frontend: `/Users/malevich/Documents/Playground/motrend/public/app.js`
- backend routes: `/Users/malevich/Documents/Playground/moads-platform/services/api/src/routes/billing.ts`
- DB billing logic: `/Users/malevich/Documents/Playground/moads-platform/packages/db/src/billing.ts`
- pack defaults: `/Users/malevich/Documents/Playground/moads-platform/packages/db/src/motrend-billing.ts`
- pack upsert script: `/Users/malevich/Documents/Playground/moads-platform/infra/scripts/upsert-motrend-credit-packs.ts`

## 3) Frontend Payment Contract (Current)

Wallet modal is implemented in `public/index.html` + `public/app.js`.

### 3.1 API calls from frontend
- `GET /billing/credit-packs`
- `GET /billing/orders`
- `POST /billing/orders/checkout` with body:
```json
{
  "priceId": "<billing_price_id>"
}
```

### 3.2 Expected response shapes

`GET /billing/credit-packs`:
```json
{
  "packs": [
    {
      "billingProductId": "string",
      "billingProductCode": "string",
      "priceId": "string",
      "name": "string",
      "creditsAmount": 30,
      "amountMinor": 499,
      "currencyCode": "USD",
      "marketCode": "global",
      "languageCode": "en",
      "checkoutConfigured": true
    }
  ]
}
```

`GET /billing/orders`:
```json
{
  "orders": [
    {
      "orderId": "string",
      "status": "pending|paid|failed|cancelled",
      "createdAt": "ISO datetime",
      "updatedAt": "ISO datetime",
      "billingProductCode": "motrend_credits_starter",
      "billingProductName": "Starter",
      "creditsAmount": 30,
      "amountMinor": 499,
      "currencyCode": "USD"
    }
  ]
}
```

`POST /billing/orders/checkout`:
```json
{
  "orderId": "string",
  "status": "pending",
  "redirectUrl": "https://...",
  "billingProductCode": "motrend_credits_starter",
  "creditsAmount": 30,
  "amountMinor": 499,
  "currencyCode": "USD"
}
```

### 3.3 Frontend checkout safety rules
- Redirect URL is accepted only for host suffixes:
  - `fastspring.com`
  - `onfastspring.com`
- If URL is missing or not whitelisted, frontend treats it as:
  - `billing_checkout_unavailable`
- Only one checkout opening is allowed at a time (`walletCheckoutInFlightPriceId` lock).

## 4) Backend Billing Behavior (Current)

### 4.1 Routes
- Implemented in `services/api/src/routes/billing.ts`:
  - `GET /billing/credit-packs`
  - `GET /billing/orders`
  - `POST /billing/orders/checkout`
- Guards: authenticated account context required (`requireAuth`, `resolveAccount`).

### 4.2 Checkout creation model
- `createBillingCheckoutOrder(...)`:
  - validates price/product/scope
  - checks active status
  - validates checkout URL presence
  - creates `billing_order` with status `pending`
  - writes audit log `billing.checkout_order_created`
- No client-side credit mutation.
- Wallet balance changes happen via backend ledger operations.

### 4.3 Fulfillment state (important)
- Current live flow is checkout-link creation + order record.
- Credits grant path is handled via backend fulfillment logic (manual/admin-safe path exists).
- If adding provider webhooks, map webhook terminal states to billing order status and single ledger grant idempotently.

## 5) Default MoTrend Credit Packs

Defined in `packages/db/src/motrend-billing.ts`:
- `Starter` -> `30 credits` -> `499` minor
- `Creator` -> `80 credits` -> `999` minor
- `Pro` -> `200 credits` -> `1999` minor

Codes:
- `motrend_credits_starter`
- `motrend_credits_creator`
- `motrend_credits_pro`

## 6) Runtime Configuration for Packs

`MOTREND_CREDIT_PACKS_JSON` can override defaults via env.

JSON item shape:
```json
{
  "code": "motrend_credits_starter",
  "name": "Starter",
  "creditsAmount": 30,
  "amountMinor": 499,
  "checkoutUrl": "https://...",
  "currencyCode": "USD",
  "marketCode": "global",
  "languageCode": "en"
}
```

If `checkoutUrl` is missing, pack remains visible with `checkoutConfigured=false` and button is disabled/unavailable.

## 7) Data Bootstrap / Update Procedure

Use backend script:
- `/Users/malevich/Documents/Playground/moads-platform/infra/scripts/upsert-motrend-credit-packs.ts`

Recommended run sequence:
1. Load backend env (`DATABASE_URL`, optional `MOTREND_CREDIT_PACKS_JSON`).
2. Run pack upsert script.
3. Verify `GET /billing/credit-packs` returns expected `checkoutConfigured`.
4. Verify `POST /billing/orders/checkout` returns redirect URL for each enabled pack.

## 8) Frontend-Backend Integration Checklist

1. Wallet modal opens and loads packs/orders.
2. At least one pack has `checkoutConfigured=true`.
3. Clicking `Continue` creates order and redirects to FastSpring URL.
4. Returning user sees created order in "Recent orders".
5. Credits balance update path is verified after fulfillment.
6. Invalid checkout URL never redirects (must show unavailable/failure modal).

## 9) Known Drift and Constraints

1. `/Users/malevich/motrend` is on older code (`ec5bee3`) and does not include this wallet flow.
2. `moads-platform` env examples still show `SESSION_COOKIE_MAX_AGE_MS=2592000000`, while runtime config now enforces Firebase max (14 days). Keep deployment env aligned with validated bounds.
3. Firebase Functions runtime for old MoTrend flow is removed from active path; payment work must target shared API routes above.

## 10) Recommended Base for New Payment Branch

Use:
- frontend branch from `/Users/malevich/Documents/Playground/motrend` at `33bdbbe...`
- backend branch from `/Users/malevich/Documents/Playground/moads-platform` at `cf118be...`

If work must start in `/Users/malevich/motrend`, first align it with current `origin/main` or port payment commits from canonical repo before implementation.
