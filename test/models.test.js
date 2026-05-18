import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const API_KEY = process.env.API_KEY || "";

const MODELS = globalThis.__MODELS_CONFIG__;

const headers = {
  "Content-Type": "application/json",
  ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
};

describe("Models listing", () => {
  it.skipIf(!OPENAI_BASE_URL)("returns all configured models", async () => {
    const response = await fetch(`${OPENAI_BASE_URL}/models`, { headers });
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.object).toBe("list");
    expect(Array.isArray(data.data)).toBe(true);

    const returnedTypes = data.data.map((m) => m.id).sort();
    const expectedTypes = Object.keys(MODELS).sort();
    expect(returnedTypes).toEqual(expectedTypes);
  });
});

describe("Chat model", () => {
  it.skipIf(!OPENAI_BASE_URL || !MODELS.chat)("responds to a simple prompt", async () => {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "chat",
        messages: [{ role: "user", content: "Say hello in one word." }],
        max_tokens: 50,
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.choices).toBeDefined();
    expect(data.choices.length).toBeGreaterThan(0);
    expect(data.choices[0].message).toBeDefined();
    expect(data.model).toBe(MODELS.chat);
  });

  it.skipIf(!OPENAI_BASE_URL || !MODELS.chat)("accepts the CF model id directly", async () => {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: MODELS.chat,
        messages: [{ role: "user", content: "Say hello in one word." }],
        max_tokens: 50,
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.model).toBe(MODELS.chat);
  });

  it.skipIf(!OPENAI_BASE_URL || !MODELS.chat)("streams a response in OpenAI-compatible format", async () => {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "chat",
        messages: [{ role: "user", content: "Say hello in one word." }],
        max_tokens: 50,
        stream: true,
      }),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);

    const text = await response.text();
    const lines = text.split("\n").filter((l) => l.startsWith("data: "));

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[lines.length - 1]).toBe("data: [DONE]");

    const chunks = lines
      .filter((l) => l !== "data: [DONE]")
      .map((l) => JSON.parse(l.slice(6)));

    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      expect(chunk.id).toMatch(/^chatcmpl-/);
      expect(chunk.object).toBe("chat.completion.chunk");
      expect(chunk.created).toBeTypeOf("number");
      expect(chunk.model).toBe(MODELS.chat);
      expect(chunk.choices).toHaveLength(1);
      expect(chunk.choices[0].index).toBe(0);
      expect(chunk.choices[0].delta).toBeDefined();
    }

    expect(chunks[0].choices[0].delta.role).toBe("assistant");

    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.choices[0].finish_reason).toBe("stop");

    const contentChunks = chunks.filter((c) => c.choices[0].delta.content);
    expect(contentChunks.length).toBeGreaterThan(0);
  });
});

describe("Embedding model", () => {
  it.skipIf(!OPENAI_BASE_URL || !MODELS.embedding)("generates vector embeddings", async () => {
    const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "embedding",
        input: "Hello, world!",
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.data).toBeDefined();
    expect(data.data.length).toBeGreaterThan(0);
    expect(data.data[0].embedding).toBeDefined();
    expect(Array.isArray(data.data[0].embedding)).toBe(true);
    expect(data.data[0].embedding.length).toBeGreaterThan(0);
    expect(data.model).toBe(MODELS.embedding);
  });
});

describe("TTS model", () => {
  it.skipIf(!OPENAI_BASE_URL || !MODELS.text_to_speech)("generates audio from text", async () => {
    const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "text_to_speech",
        input: "Hello, this is a test.",
      }),
    });

    expect(response.ok).toBe(true);
    const contentType = response.headers.get("content-type");
    expect(contentType).toMatch(/audio/);

    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});

describe("STT model", () => {
  it.skipIf(!OPENAI_BASE_URL || !MODELS.speech_to_text)("transcribes audio file", async () => {
    const audioPath = path.join(__dirname, "fixtures", "sample.m4a");
    const audioBuffer = fs.readFileSync(audioPath);
    const audioBlob = new Blob([audioBuffer], { type: "audio/m4a" });

    const formData = new FormData();
    formData.append("file", audioBlob, "sample.m4a");
    formData.append("model", "speech_to_text");

    const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: {
        ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
      },
      body: formData,
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.text).toBeDefined();
    expect(typeof data.text).toBe("string");
    expect(data.text.length).toBeGreaterThan(0);
  });
});
