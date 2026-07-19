# Cloudflare AI Deployer — open.notebooker.ai

Deploy an **OpenAI-compatible endpoint** backed by [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) to your own Cloudflare account — from your browser.

**Use it hosted at [open.notebooker.ai](https://open.notebooker.ai)**, or clone this repo and run the same app locally.

Pick models from the live Cloudflare catalog, deploy, and test everything in the browser: streaming chat, text-to-speech, speech-to-text (file upload), vision (image upload), and embeddings similarity — plus an estimated free-tier usage monitor and a downloadable `credentials.txt` for your endpoint.

Supports `chat/completions` (including vision models), `embeddings`, `audio/transcriptions`, and `audio/speech` — each endpoint is enabled only if you pick a model for it.

## How it works

- **No login, no database.** You paste a scoped Cloudflare API token; it lives only in an AES-GCM-encrypted, expiring `HttpOnly` cookie. Every Cloudflare call is proxied server-side, so the token never reaches the browser. Delete the token in Cloudflare when you're done — a new one restores access later.
- **Config is remembered in *your* account.** Worker name + models (never secrets) are stored in a KV namespace in your own Cloudflare account and rediscovered on your next visit.
- **The endpoint API key is never persisted anywhere.** It exists as the worker's write-only secret and, transiently, in your session cookie. Save it when it's shown (or download `credentials.txt`); renewing replaces it. Model changes never touch the key (the redeploy uses an `inherit` binding).
- **Just testing?** Upload your `credentials.txt` (or enter base URL + key) on the homepage to use the testers without any Cloudflare token — management stays locked until you provide one.

## Using the app

1. Open **[open.notebooker.ai](https://open.notebooker.ai)** (or your local instance).
2. Follow the *Before you start* checklist: verify your Cloudflare account email, and visit [Workers AI](https://dash.cloudflare.com/?to=/:account/ai/workers-ai) once so your `workers.dev` subdomain gets registered.
3. Create a **Custom API token** at [dash.cloudflare.com → API Tokens](https://dash.cloudflare.com/profile/api-tokens), scoped to your account:

   | Resource            | Permission |
   |---------------------|------------|
   | Workers Scripts     | Edit       |
   | Workers KV Storage  | Edit       |
   | Workers AI          | Read       |
   | Account Analytics   | Read       |

4. Paste it in, pick your models, deploy, test, and download your credentials.

> **Gated models:** some Meta models (e.g. `@cf/meta/llama-3.2-11b-vision-instruct`) need a one-time license agreement per account — if chat replies with a license notice, send the single message `agree` once.
>
> `@cf/deepgram/flux` is WebSocket-only and can't work through this request/response API (it's filtered from the picker).

## Running locally

```bash
git clone https://github.com/Notebooker-ai/cloudflare-ai-deployer
cd cloudflare-ai-deployer/web
npm install
npm run dev            # http://localhost:4321
```

`web/.dev.vars` ships with a dev-only `SESSION_SECRET`. Paste your scoped token on the landing page and you get the full dashboard against your own account. See [`web/README.md`](./web/README.md) for architecture, the security model, and deploying your own instance.

## Using your endpoint

Point any OpenAI-compatible client at your base URL with your bearer key:

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://<worker>.<your-subdomain>.workers.dev/v1",
  apiKey: "<your bearer key>",
});

const res = await client.chat.completions.create({
  model: "chat",
  messages: [{ role: "user", content: "Hello!" }],
});
```

Or with `curl`:

```bash
# Chat
curl $BASE_URL/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"Hi"}]}'

# Embeddings
curl $BASE_URL/embeddings \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"embedding","input":"hello world"}'

# Text-to-speech (writes audio file)
curl $BASE_URL/audio/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"text_to_speech","input":"Hello!"}' \
  --output speech.wav

# Speech-to-text
curl $BASE_URL/audio/transcriptions \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@sample.m4a" \
  -F "model=speech_to_text"
```

The `model` field accepts either the type alias (`chat`, `embedding`, `text_to_speech`, `speech_to_text`) or the full Cloudflare model id.

To use your endpoint inside **Notebooker.ai**, see the guide: **[Run your own AI provider](https://notebooker.ai/docs/custom-ai-provider/)**.

## Repo layout

```
workers/template-unified.js   the worker that gets deployed (single source of truth)
web/                          the Astro app (open.notebooker.ai)
test/                         vitest suite for the worker template
```

## Tests

Unit tests run without credentials:

```bash
npm test
```

To run the integration suites against a deployed worker, create a `.env` with:

```
OPENAI_BASE_URL=https://<worker>.<your-subdomain>.workers.dev/v1
API_KEY=<your bearer key>
```

Then `npm test` again — integration tests auto-skip any endpoint type that isn't deployed.
