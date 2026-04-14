# MoTrend Payment Module Integration Spec

Last updated: 2026-04-14 (Europe/Madrid)
Status: Beta v1 working snapshot

This document is the practical payment handoff for the current MoTrend beta stack.

## 1. Git and Runtime Anchors

### Canonical frontend repo
- Path: `/Users/malevich/Documents/Playground/motrend`
- Branch: `feature/motrend-wallet-fastspring`
- Current committed anchor at snapshot start: `b4bb9b1b3b6a7a097457dfb54f98c7a57ca49ec6`

### Secondary local clone
- Path: `/Users/malevich/motrend`
- Branch: `main`
- Local-only mirror for docs/reference

### Backend repo
- Path: `/Users/malevich/Documents/Playground/moads-platform`
- Branch: `feature/motrend-wallet-fastspring`
- Current committed anchor: `73c12443f33fb153714c8442a546751fe8004160`

### Live runtime
- Frontend: [https://trend.moads.agency](https://trend.moads.agency)
- API: [https://api.moads.agency](https://api.moads.agency)
- Health: [https://api.moads.agency/health](https://api.moads.agency/health)

### Current Beta v1 payment note
- Active payment provider: `Dodo Payments`
- QA has temporarily exercised the prod contour with `DODO_ENVIRONMENT=test_mode`
- Wallet and order flows remain the same in both live/test Dodo environments

## 2. Current Payment Architecture

### Frontend payment surfaces
- Wallet modal in:
  - [/Users/malevich/Documents/Playground/motrend/public/index.html](/Users/malevich/Documents/Playground/motrend/public/index.html)
  - [/Users/malevich/Documents/Playground/motrend/public/app.js](/Users/malevich/Documents/Playground/motrend/public/app.js)

### Backend routes
- [/Users/malevich/Documents/Playground/moads-platform/services/api/src/routes/billing.ts](/Users/malevich/Documents/Playground/moads-platform/services/api/src/routes/billing.ts)

Current MoTrend billing endpoints:
- `GET /billing/credit-packs`
- `GET /billing/orders`
- `POST /billing/orders/checkout`
- `POST /billing/webhooks/dodo`

### DB and billing logic
- [/Users/malevich/Documents/Playground/moads-platform/packages/db/src/billing.ts](/Users/malevich/Documents/Playground/moads-platform/packages/db/src/billing.ts)
- [/Users/malevich/Documents/Playground/moads-platform/packages/db/src/motrend-billing.ts](/Users/malevich/Documents/Playground/moads-platform/packages/db/src/motrend-billing.ts)
- [/Users/malevich/Documents/Playground/moads-platform/infra/scripts/upsert-motrend-credit-packs.ts](/Users/malevich/Documents/Playground/moads-platform/infra/scripts/upsert-motrend-credit-packs.ts)

## 3. Wallet Contract

### `GET /billing/credit-packs`

Expected shape:

```json
{
  "packs": [
    {
      "billingProductId": "string",
      "billingProductCode": "motrend_credits_starter",
      "priceId": "string",
      "name": "Starter",
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

### `GET /billing/orders`

Expected shape:

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

### `POST /billing/orders/checkout`

Request:

```json
{
  "priceId": "<billing_price_id>"
}
```

Response:

```json
{
  "orderId": "string",
  "status": "pending",
  "redirectUrl": "https://checkout.dodopayments.com/session/...",
  "billingProductCode": "motrend_credits_starter",
  "creditsAmount": 30,
  "amountMinor": 499,
  "currencyCode": "USD"
}
```

## 4. Dodo Integration Details

### Active provider code
- `dodo`

### Checkout session builder
- [/Users/malevich/Documents/Playground/moads-platform/services/api/src/lib/dodo.ts](/Users/malevich/Documents/Playground/moads-platform/services/api/src/lib/dodo.ts)

Current checkout configuration goals:
- `minimal_address: true`
- preferred `billing_currency: "USD"`
- restricted payment methods:
  - `credit`
  - `debit`
  - `apple_pay`
  - `google_pay`

Important practical note:
- Dodo may still request country and some address/tax fields depending on jurisdiction, tax rules, and adaptive currency behavior.
- These flags reduce friction but do not guarantee a no-address checkout.

### Return flow
- Checkout return goes back into the MoTrend app
- Wallet resumes pending checkout state
- On successful fulfillment the user should see updated balance and the recent order row

## 5. Current Pack Definitions

Canonical MoTrend packs:

1. Starter
- `motrend_credits_starter`
- `30 credits`
- `499` minor

2. Creator
- `motrend_credits_creator`
- `80 credits`
- `999` minor

3. Pro
- `motrend_credits_pro`
- `200 credits`
- `1999` minor

## 6. Dodo Product Mapping

### Live Dodo product IDs
- Starter: `pdt_0NbveLQCLSD2Mooo7VM4P`
- Creator: `pdt_0NbveJet1CbAWPjsr6eRw`
- Pro: `pdt_0NbveKvRWgGzOx2H7hrdc`

### Test Dodo product IDs
- Starter: `pdt_0Nbn3AengyfOHAGPiGibQ`
- Creator: `pdt_0Nbn3kZhICn5HGrxLBvSx`
- Pro: `pdt_0Nbn40LuSVJ47oKbWRsSd`

### Runtime note
- During Beta v1 QA, the production contour may temporarily point to the test IDs above when `DODO_ENVIRONMENT=test_mode` is being exercised.
- The wallet UI itself does not change; only the provider target changes.

## 7. Secrets and Environment

Relevant secrets in GCP:
- `DODO_API_KEY`
- `DODO_WEBHOOK_SECRET` or `DODO_WEBHOOK_KEY`

Important runtime envs:
- `DODO_ENVIRONMENT=live_mode|test_mode`
- optional `DODO_BASE_URL`

Production deploy script:
- [/Users/malevich/Documents/Playground/moads-platform/infra/scripts/cloud/deploy-moads-api-prod.sh](/Users/malevich/Documents/Playground/moads-platform/infra/scripts/cloud/deploy-moads-api-prod.sh)

## 8. Fulfillment Rules

Source of truth for credit grants is always backend-side ledger logic.

Rules:

1. Frontend never increments credits directly.
2. A paid Dodo order must map to one backend billing order.
3. Fulfillment must be idempotent.
4. A repeated webhook must not double-credit the wallet.
5. Failed or abandoned orders must not change the wallet.

## 9. Checkout Metadata and Attribution

Beta v1 checkout metadata is intentionally kept compact.

Current goals:
- keep order correlation intact
- carry attribution essentials
- avoid oversized or provider-rejected metadata payloads

Attribution sources:
- first-party cookies
- GTM/Firebase tracking state
- restored returning-user identifiers

## 10. Beta v1 QA Checklist

### Safe QA

1. Existing user login
2. Open wallet
3. Load packs and orders
4. Start Dodo checkout
5. Complete test checkout when runtime is in `test_mode`
6. Verify return flow and wallet update

### Gift / account rules to verify

1. Fresh browser signup gets `3` credits
2. Same browser second signup is allowed
3. Same browser second signup gets no gift
4. Incognito/new cookie jar can also be gift-suppressed by server-side fingerprint cooldown

### Share / watch / recovery rules to verify

1. Completed job watch/save/share buttons work
2. Public share uses `/v/<slug>`
3. Expired prepared artifacts show `Prepare download`
4. After prepare, watch/download/share return

## 11. Known Beta v1 Constraints

1. Dodo address collection cannot be fully eliminated from our side if Dodo/tax rules require it.
2. iPhone/Safari preview behavior can still be inconsistent for links that do not yet have a persisted generated preview asset.
3. The secondary local `motrend` clone is not the canonical implementation source.

## 12. Recommended Base for Ongoing Payment Work

Treat these files as source of truth:

- frontend wallet flow:
  - [/Users/malevich/Documents/Playground/motrend/public/app.js](/Users/malevich/Documents/Playground/motrend/public/app.js)
- backend billing routes:
  - [/Users/malevich/Documents/Playground/moads-platform/services/api/src/routes/billing.ts](/Users/malevich/Documents/Playground/moads-platform/services/api/src/routes/billing.ts)
- Dodo provider integration:
  - [/Users/malevich/Documents/Playground/moads-platform/services/api/src/lib/dodo.ts](/Users/malevich/Documents/Playground/moads-platform/services/api/src/lib/dodo.ts)
- DB billing logic:
  - [/Users/malevich/Documents/Playground/moads-platform/packages/db/src/billing.ts](/Users/malevich/Documents/Playground/moads-platform/packages/db/src/billing.ts)
- pack defaults:
  - [/Users/malevich/Documents/Playground/moads-platform/packages/db/src/motrend-billing.ts](/Users/malevich/Documents/Playground/moads-platform/packages/db/src/motrend-billing.ts)
