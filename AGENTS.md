<!-- MOADS-AI-CONTRACT:START -->
# AI Engineering Safety / Privacy / Cost Contract

This block is inherited policy for all AI-assisted engineering in this
repository. Project-specific rules may be stricter, but MUST NOT weaken it.

## Canonical workspace

- Work only in the current canonical repository under:
  `/Users/malevich/Documents/Playground/`
- `/Users/malevich/motrend` and its nested `Archive/` are historical/legacy
  material and MUST NOT be used for active development.
- Before Git mutations, determine the actual repository root.
- Never run broad `git add -A` from the Playground parent repository.

## External AI privacy boundary

Treat every external/free LLM, model gateway, web-search service, browser,
MCP server and third-party API as an UNTRUSTED DATA ZONE.

Never send raw:

- API keys, passwords, access/refresh tokens, cookies or auth headers;
- `.env` values or secret-manager payloads;
- private keys or service-account credentials;
- customer/user names, emails, phones, addresses or payment information;
- CRM records or production database rows containing identifiable people;
- unsanitized production HTTP bodies, logs, traces or stack traces containing
  user data.

Secrets may be referenced by secret NAME only. Secret values stay in trusted
local/cloud secret storage.

For analytics:

- prefer random surrogate UUID/ULID identifiers;
- keep identity mappings in trusted/restricted storage;
- if deterministic cross-system matching is genuinely required, use a
  protected HMAC-based identifier;
- do not use simple unsalted hashes as pseudonymization;
- external AI should not automatically resolve surrogate IDs back to people.

Use synthetic test data by default.

Sanitize logs, traces, payloads and examples before exposing them to any
external model.

Private Git repositories are NOT a secrets/PII store.

## Cost policy

ZERO / near-zero monetary cost is the default.

AI:
- FREE models only.
- Never automatically fall back from FREE to paid models.

Engineering:
- do not use paid APIs merely for testing;
- do not create paid cloud infrastructure "just in case";
- minimize metered cloud operations;
- minimize cloud builds and deployments.

## Local-first verification hierarchy

Use the cheapest sufficient level first:

1. code/config inspection;
2. static analysis;
3. unit tests;
4. mocks / fixtures;
5. local runtime;
6. Docker, only when useful;
7. Firebase/local emulators;
8. local browser/integration testing;
9. existing cloud logs and read-only metadata;
10. DEV cloud only when local verification is insufficient;
11. PROD only as final release verification under explicit user control.

Do not escalate to a more expensive layer when a cheaper layer can answer
the question.

## Cloud safety

- Cloud reads may be used when necessary, subject to privacy sanitization.
- Automated mutation is DEV-only and only for positively identified DEV.
- PROD/UNKNOWN cloud mutation is prohibited for unattended agents.
- IAM, billing, credentials, secret values and destructive database operations
  are protected operations.
- Do not autonomously run Cloud Build merely as a verification shortcut.

## Git / user-work safety

Existing dirty working trees are USER WORK.

Never automatically:

- discard or overwrite uncommitted changes;
- `git reset --hard`;
- `git clean -f`;
- force-push;
- destructively rewrite history;
- delete branches or worktrees containing unique work.

Use meaningful recovery checkpoints before substantial reversible mutation.

## Documentation

Current code and verified runtime state outrank stale documentation.

When documentation conflicts with implementation:

1. inspect the actual code/config/runtime;
2. identify the mismatch;
3. update documentation deliberately;
4. do not alter working code merely to make it match an old document.

## Agent behavior

Use the narrowest capable specialist.

Read-only/research/review agents must not route around their permissions by
delegating to mutating agents.

During unattended work:
- safe work continues without waking the user;
- prohibited/high-risk operations are skipped and recorded as blockers;
- never bypass a DENY.

User-facing completion reports should be in Russian.
Durable engineering context, architecture notes, handoffs and code-facing
documentation should normally be in English.
<!-- MOADS-AI-CONTRACT:END -->


# AGENTS.md — motrend (MoTrend static frontend)

The **active** MoTrend consumer frontend. Read `README.md` first. Communicate in Russian;
keep code, comments and technical docs in English. Do not treat this repo as obsolete and do
not move or delete it without approval.

## Start here every session

```bash
pwd && git rev-parse --show-toplevel && git branch --show-current && git status --short
```

Existing uncommitted changes belong to the user. Never `reset`, `clean`, `checkout --` or
`stash` work you did not create.

## Scope

| This repo owns | NOT this repo |
|---|---|
| `public/` static app (HTML/CSS/vanilla JS) | shared API, DB, auth, wallet, billing, tasks |
| `functions/` Firebase Cloud Functions (Node 22, TS → `lib/`) | AEO / LAB products |
| `firestore.rules`, `firestore.indexes.json`, `storage.rules` | the site factory (`../moads-sites`) |
| Firebase Hosting config for this app | the legacy clone at `/Users/malevich/motrend` |

Runtime/API/DB/auth/billing/task behaviour belongs in `../moads-platform`. `/v/:slug` on
Hosting is a 302 redirect to the platform API (`api.moads.agency/public/motrend/v/:slug`) —
changing that redirect is a cross-repo contract change.

## Layout

```
public/            index.html, save-video.html, app.js, save-video.js, styles/, assets/, fonts/
functions/         src/ (TS) → lib/ (build output, gitignored), test/
scripts/           prepare-hosting-public.sh, delete-user-by-email.js
design/            design/tokens.json — source of design tokens
docs/              architecture/roadmap spec, component spec, design system, UX audit
firebase.json                      default config (hosting public/ + firestore database "motrend", us-central1)
firebase.hosting.dev.json          site moads-trend-dev, public = .firebase-hosting/motrend-dev-public
firebase.hosting.prod.json         site gen-lang-client-0651837818, public = public
.firebaserc                        default/prod/dev aliases — READ THIS BEFORE ANY DEPLOY
deploy-dev.sh                      hosting-only deploy of moads-trend-dev
deploy-prod-frontend.sh            production frontend deploy
deploy-prod.sh                     DEPRECATED — hard-exits with an error, dead code below it
```

## Commands

```bash
# functions
cd functions && npm run build      # tsc
cd functions && npm test           # build + node --test test/**/*.test.js
cd functions && npm run lint

# local emulated functions
cd functions && npm run serve      # build + firebase emulators:start --only functions
cd functions && npm run shell      # build + firebase functions:shell
```

There is no bundler, no linter for the static frontend and no CI workflow in this repo.
`functions/lib/` is build output — never hand-edit or commit it.

## Environment and hosting bindings (read carefully)

`.firebaserc` in this clone maps **all three aliases to the same project**:

| Alias | Project id | Reality |
|---|---|---|
| `default` | `gen-lang-client-0651837818` | PROD |
| `prod` | `gen-lang-client-0651837818` | PROD |
| `dev` | `gen-lang-client-0651837818` | **also PROD** |

`deploy-dev.sh` deploys Hosting site `moads-trend-dev` **inside the PROD project**
`gen-lang-client-0651837818`. There is no isolated staging for this app. The separate
project `motrend-dev` reached `DELETE_REQUESTED` on 2026-09-20 — do not restore or reuse it.

Consequences:
- Never run bare `firebase deploy` or `firebase use` from this repo.
- Always pass `--project` and `--config` explicitly; never inherit ambient config.
- "dev" here means a dev *hosting site*, not a dev environment. Treat all three aliases as PROD.

## Canonical docs

| Topic | File |
|---|---|
| architecture + roadmap | `docs/MOTREND_TECHNICAL_ARCHITECTURE_AND_ROADMAP_SPEC.md` |
| product/technical overview | `TECHNICAL_OVERVIEW.md` |
| payment module integration | `PAYMENT_MODULE_INTEGRATION_SPEC.md` |
| component spec | `docs/component-spec.md` |
| copy and states | `docs/copy-and-states.md` |
| design system plan | `docs/design-system-plan.md` |
| UX redesign audit | `docs/ux-redesign-audit.md` |

Historical specs describe past implementation intent, not current authority. Update current
status only from verified facts and keep useful historical requirements separately.

## Safety boundaries

- Default to source inspection and local tests. Read-only inspection authorizes nothing else.
- Never run `firebase deploy`, `deploy-prod.sh`, `deploy-prod-frontend.sh` or
  `deploy-dev.sh` without explicit per-invocation authorization. Commit, push and deploy are
  three separate permissions.
- Before an authorized release verify local HEAD vs remote, a clean release scope, the exact
  target site/project, and the rollback hosting version.
- Never print or commit secret values, `.env` contents, tokens or cookies.
- Do not use real payments or provider jobs as UI tests.
- Shared behaviour changes require a cross-product impact review (AEO / LAB / MoTrend).
- Run targeted checks and `git diff --check`; report failures and skipped checks honestly.

## Agent configuration

`.agents/rules/` and `.agents/skills/` are the Antigravity-format source of truth; `kilo.json`
wires them into Kilo. Do not duplicate them into `.kilo/`. Available skills:
`moads-task-router`, `moads-scoped-verification`, `moads-release-preflight`.

Ignored, never commit: `node_modules/`, `functions/lib/`, `.firebase/`, `.firebase-hosting/`,
`firebase-debug*.log`, `.cursor/`, `.DS_Store`, `*.log`, `config/*.env`, `.env`.
