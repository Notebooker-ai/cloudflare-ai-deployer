# Open Notebooker — self-serve Cloudflare AI deployer

An Astro app (deployed to **open.notebooker.ai**) that lets anyone stand up an
OpenAI-compatible Workers AI endpoint on *their own* Cloudflare account — with
live model management, API-key view/copy/cycle, in-browser chat + TTS testing,
and an estimated free-neuron usage monitor.

- **No login, no database.** A visitor pastes a scoped Cloudflare API token; it
  lives only in an AES-GCM-encrypted, expiring `HttpOnly` cookie. Every
  Cloudflare call is proxied server-side so the token never reaches the browser.
  Users are advised to delete the token in Cloudflare when done — a new token
  restores dashboard access on a later visit.
- **Config remembered across visits with zero server state.** The generated
  config (worker name + models — never secrets) is stored in a KV namespace
  **in the user's own account**, titled `cf-ai-deployer:<workerName>`. On a
  return visit we rediscover it by listing their namespaces.
- **The endpoint API key is never persisted anywhere.** It exists as the
  worker's write-only `secret_text` binding (enforcement) and, transiently, in
  the session cookie (display + in-browser testing). Redeploys carry the secret
  forward with an `inherit` binding, so model changes never touch the key. On a
  return visit the key can't be shown — the user renews (cycles) it to view a
  new one, which replaces the old. Legacy KV blobs that stored a key are
  scrubbed on first discovery.
- The deployable worker is the repo's shared `../workers/template-unified.js`,
  imported via Vite `?raw` and injected exactly like the `deploy.js` CLI.

## Local development

```sh
cd web
npm install
# .dev.vars already contains a dev SESSION_SECRET
npm run dev            # http://localhost:4321
```

Paste a scoped Cloudflare API token on the landing page. Token needs:

| Permission            | Level |
| --------------------- | ----- |
| Workers Scripts       | Edit  |
| Workers KV Storage    | Edit  |
| Workers AI            | Read  |
| Account Analytics     | Read  |

Scope **Account Resources** to a single account. Cloudflare can't scope a token
to one worker/namespace, so use a dedicated, revocable token. (The app validates
tokens by listing accessible accounts, so "User Details: Read" is not required.)

## Deploying to open.notebooker.ai

The app is itself a Cloudflare Worker (via `@astrojs/cloudflare`). One-time setup:

```sh
cd web

# 1) Authenticate wrangler (interactive) — run in your own shell:
#    wrangler login
#    (or export CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)

# 2) Create the KV namespace Astro's session store needs, then paste the
#    returned id into wrangler.jsonc (replace PLACEHOLDER_REPLACE_WITH_REAL_NAMESPACE_ID):
wrangler kv namespace create SESSION

# 3) Set the cookie-encryption secret (use a long random value):
wrangler secret put SESSION_SECRET

# 4) Build + deploy. The custom domain open.notebooker.ai is wired via the
#    `routes` entry in wrangler.jsonc (the notebooker.ai zone must be in the
#    same account).
npm run deploy
```

## How it fits the existing CLI

`../deploy.js` still works unchanged for CLI deploys. Both the CLI and this app
inject models into the same `../workers/template-unified.js`. (Note: the template
comment previously duplicated the quoted `"__DEPLOY_INJECT_CONFIG__"` token,
which made the CLI's first-match `.replace()` hit the comment instead of the real
assignment — that comment was fixed so both paths inject correctly.)

## Layout

```
web/src/
  lib/        session.ts (cookie crypto) · auth.ts (guard) · cfApi.ts (CF REST/GraphQL)
              template.ts (?raw inject) · kvStore.ts (in-account config) · deployer.ts
              (deploy/discover/cycle) · usage.ts (neuron estimate) · util.ts
  pages/      index.astro · dashboard.astro
  pages/api/  session · worker · models/catalog · apikey · apikey/cycle
              test/chat · test/tts · usage
  components/ TokenGate · Dashboard · ModelPicker · ApiKeyPanel · ChatTester
              · TtsTester · UsagePanel
```
