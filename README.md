# Cloudflare AI Deployer

Deploy an **OpenAI-compatible endpoint** backed by [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) in one command. Pick the models you want, run `npm run deploy`, and you get a URL + bearer key you can drop into any OpenAI SDK.

Supports `chat/completions`, `embeddings`, `audio/transcriptions`, and `audio/speech` — each endpoint is enabled only if you list a model for it.

## Prerequisites

- Node.js 18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (the free plan is enough to get started)
- Your **Cloudflare Account ID** and a **Cloudflare API token** — see below

### Find your Account ID

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/).
2. Pick any site, or go to **Workers & Pages** → **Overview**.
3. Your Account ID is shown in the right-hand sidebar — click to copy.

Direct link: **https://dash.cloudflare.com/?to=/:account/workers-and-pages**

### Create an API token

1. Go to **https://dash.cloudflare.com/profile/api-tokens**.
2. Click **Create Token** → **Create Custom Token**.
3. Give it a name (e.g. `cloudflare-ai-deployer`) and add these permissions:

   | Type     | Resource           | Permission |
   |----------|--------------------|------------|
   | Account  | Workers Scripts    | Edit       |
   | Account  | Workers AI         | Read       |
   | User     | User Details       | Read       |

4. Under **Account Resources**, scope it to the account you got the Account ID from.
5. Click **Continue to summary** → **Create Token** and copy the token (you only see it once).

> The built-in **"Edit Cloudflare Workers"** template also works if you'd rather not pick permissions manually — it just grants more than is strictly needed.

## Setup

```bash
git clone <this-repo> cloudflare-ai-deployer
cd cloudflare-ai-deployer
npm install
cp .env.example .env
```

Then open `.env` and fill in:

```
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
```

## Pick your models

Open `models.json`. The keys are the four supported endpoint types; the values are Cloudflare Workers AI model ids. **Omit any key to disable that endpoint.**

```json
{
  "chat": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "embedding": "@cf/baai/bge-base-en-v1.5",
  "text_to_speech": "@cf/myshell-ai/melotts",
  "speech_to_text": "@cf/openai/whisper-large-v3-turbo"
}
```

Browse the full catalog and copy-paste any model id from the Cloudflare model directory:

**https://developers.cloudflare.com/workers-ai/models/**

Filter by task type to find a model for each slot:

| `models.json` key | Cloudflare filter         | Example model ids |
|-------------------|---------------------------|-------------------|
| `chat`            | **Text Generation**       | `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/qwen/qwen3-30b-a3b-fp8` |
| `embedding`       | **Text Embeddings**       | `@cf/baai/bge-base-en-v1.5`, `@cf/google/embeddinggemma-300m` |
| `text_to_speech`  | **Text-to-Speech**        | `@cf/myshell-ai/melotts` |
| `speech_to_text`  | **Automatic Speech Recognition** | `@cf/openai/whisper-large-v3-turbo` |

If you want vision support, just use a vision-capable model under `chat` (e.g. `@cf/meta/llama-3.2-11b-vision-instruct`).

## Deploy

```bash
npm run deploy
```

On success it prints something like:

```
🌐 Your endpoint is live

   Base URL:        https://cloudflare-ai.<account-id>.workers.dev/v1
   Bearer API key:  3f2a1c…  (64 hex chars)
```

The bearer key is auto-generated on first deploy and saved to `.env` as `API_KEY`. Re-running `npm run deploy` reuses it.

To rename the worker subdomain, set `WORKER_NAME` in `.env` before deploying.

To preview a deploy without touching Cloudflare:

```bash
npm run deploy:dry-run
```

## Use it

Point any OpenAI-compatible client at the printed `Base URL` and use the printed key.

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://cloudflare-ai.<account-id>.workers.dev/v1",
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

# Text-to-speech (writes wav)
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

The `model` field accepts either the type alias (`chat`, `embedding`, …) or the full Cloudflare model id you put in `models.json`.

## Use it with Notebooker.ai

[Notebooker.ai](https://app.notebooker.ai/) ships an embedded instance of [open-notebook](https://github.com/lfnovo/open-notebook) that can talk to any OpenAI-compatible endpoint — so you can point it at your freshly deployed worker.

1. Open the API Keys settings: **https://app.notebooker.ai/open-notebook?path=settings%2Fapi-keys**
2. Under **Models**, add a new **OpenAI Compatible** configuration.
3. Fill in the modal:

   ![Add Configuration modal in Notebooker](./img/notebooker-modal.png)

   - **Configuration Name**: anything memorable (e.g. `Cloudflare Workers AI`)
   - **API Key**: the bearer key printed by `npm run deploy` (saved in `.env` as `API_KEY`)
   - **Base URL**: your worker's base URL, e.g. `https://cloudflare-ai.<account-id>.workers.dev/v1`

4. Click **Add Configuration**. The models you listed in `models.json` are now available inside Notebooker using their type aliases (`chat`, `embedding`, `text_to_speech`, `speech_to_text`) or their full Cloudflare model ids.

## Tests

Unit tests run without credentials:

```bash
npm test
```

To run the integration suites against your deployed worker, set `OPENAI_BASE_URL` and `API_KEY` in `.env` (the deploy step already fills `API_KEY`):

```
OPENAI_BASE_URL=https://cloudflare-ai.<account-id>.workers.dev/v1
```

Then `npm test` again — the integration tests will auto-skip any endpoint type that isn't configured in `models.json`.
