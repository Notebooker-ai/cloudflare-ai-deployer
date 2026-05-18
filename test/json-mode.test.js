import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.OPENAI_BASE_URL;
const API_KEY = process.env.API_KEY;
const MODELS = globalThis.__MODELS_CONFIG__;
const SKIP = !BASE_URL || !MODELS.chat;

async function chat(messages, options = {}) {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'chat',
            messages,
            temperature: 0.3,
            response_format: { type: 'json_object' },
            ...options,
        }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

async function chatText(messages, options = {}) {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'chat',
            messages,
            temperature: 0.3,
            ...options,
        }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

function isValidJson(str) {
    try {
        JSON.parse(str);
        return true;
    } catch {
        return false;
    }
}

function hasThinkTags(content) {
    return /<think>/i.test(content) || /<\/think>/i.test(content);
}

describe.skipIf(SKIP)('JSON Output Mode', () => {
    describe('Always returns valid JSON', () => {
        it('should return valid JSON for simple questions', async () => {
            const content = await chat([
                { role: 'user', content: 'What is 2 + 2? Return JSON with key "answer".' },
            ]);
            expect(isValidJson(content)).toBe(true);
            const parsed = JSON.parse(content);
            expect(parsed).toHaveProperty('answer');
        });

        it('should return valid JSON for list requests', async () => {
            const content = await chat([
                { role: 'user', content: 'List 3 colors. Return JSON with key "colors" as an array.' },
            ]);
            expect(isValidJson(content)).toBe(true);
            const parsed = JSON.parse(content);
            expect(parsed).toHaveProperty('colors');
            expect(Array.isArray(parsed.colors)).toBe(true);
        });

        it('should return valid JSON for complex objects', async () => {
            const content = await chat([
                { role: 'user', content: 'Describe a car. Return JSON with keys: make, model, year, color.' },
            ]);
            expect(isValidJson(content)).toBe(true);
            const parsed = JSON.parse(content);
            expect(parsed).toHaveProperty('make');
            expect(parsed).toHaveProperty('model');
        });

        it('should return valid JSON even without explicit JSON request', async () => {
            const content = await chat([
                { role: 'system', content: 'Always respond with valid JSON containing a "response" key.' },
                { role: 'user', content: 'Hello' },
            ]);
            expect(isValidJson(content)).toBe(true);
        });
    });

    describe('JSON mode prevents think tags', () => {
        it('should not include think tags in JSON output when explicitly requested', async () => {
            const content = await chat([
                { role: 'system', content: 'Use <think></think> tags for reasoning, then output JSON.' },
                { role: 'user', content: 'What is 5 + 5? Return {"answer": <number>}' },
            ]);
            expect(hasThinkTags(content)).toBe(false);
            expect(isValidJson(content)).toBe(true);
        });

        it('should output clean JSON without reasoning artifacts', async () => {
            const content = await chat([
                { role: 'user', content: 'Think carefully then answer: Is 7 prime? Return {"number": 7, "is_prime": <boolean>}' },
            ]);
            expect(hasThinkTags(content)).toBe(false);
            expect(isValidJson(content)).toBe(true);
        });
    });

    describe('Handles various JSON schemas', () => {
        it('should handle nested objects', async () => {
            const content = await chat([
                { role: 'user', content: 'Return JSON: {"person": {"name": "John", "age": 30, "address": {"city": "NYC"}}}' },
            ]);
            expect(isValidJson(content)).toBe(true);
            const parsed = JSON.parse(content);
            expect(parsed.person.address.city).toBeDefined();
        });

        it('should handle arrays of objects', async () => {
            const content = await chat([
                { role: 'user', content: 'Return JSON array of 2 users with name and id fields.' },
            ]);
            expect(isValidJson(content)).toBe(true);
            const parsed = JSON.parse(content);
            const users = Array.isArray(parsed) ? parsed : parsed.users;
            expect(Array.isArray(users)).toBe(true);
            expect(users.length).toBeGreaterThanOrEqual(2);
        });

        it('should handle boolean values correctly', async () => {
            const content = await chat([
                { role: 'user', content: 'Return JSON: {"active": true, "deleted": false}' },
            ]);
            expect(isValidJson(content)).toBe(true);
            const parsed = JSON.parse(content);
            expect(parsed.active).toBe(true);
            expect(parsed.deleted).toBe(false);
        });

        it('should handle null values', async () => {
            const content = await chat([
                { role: 'user', content: 'Return JSON: {"name": "test", "value": null}' },
            ]);
            expect(isValidJson(content)).toBe(true);
            const parsed = JSON.parse(content);
            expect(parsed.value).toBeNull();
        });
    });

    describe('Edge cases', () => {
        it('should handle special characters in strings', async () => {
            const content = await chat([
                { role: 'user', content: 'Return JSON: {"message": "Hello, world! How are you?"}' },
            ]);
            expect(isValidJson(content)).toBe(true);
        });

        it('should handle empty objects', async () => {
            const content = await chat([
                { role: 'user', content: 'Return an empty JSON object: {}' },
            ]);
            expect(isValidJson(content)).toBe(true);
        });

        it('should handle empty arrays', async () => {
            const content = await chat([
                { role: 'user', content: 'Return JSON: {"items": []}' },
            ]);
            expect(isValidJson(content)).toBe(true);
            const parsed = JSON.parse(content);
            expect(Array.isArray(parsed.items)).toBe(true);
        });

        it('should handle unicode characters', async () => {
            const content = await chat([
                { role: 'user', content: 'Return JSON: {"greeting": "你好", "emoji": "👋"}' },
            ]);
            expect(isValidJson(content)).toBe(true);
        });
    });
});

describe.skipIf(SKIP)('"structured" parameter support (Esperanto/LangChain)', () => {
    async function chatWithStructured(messages, options = {}) {
        const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'chat',
                messages,
                temperature: 0.3,
                structured: { type: 'json' },
                ...options,
            }),
        });

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    }

    it('should trigger JSON mode with "structured" parameter', async () => {
        const content = await chatWithStructured([
            { role: 'user', content: 'Return JSON: {"hello": "world"}' },
        ], { max_tokens: 200 });

        expect(content.trim().startsWith('{')).toBe(true);
        expect(isValidJson(content)).toBe(true);
    });
});

describe.skipIf(SKIP)('Text Output Mode (no response_format)', () => {
    describe('Returns natural text responses', () => {
        it('should return plain text without JSON enforcement', async () => {
            const content = await chatText([
                { role: 'user', content: 'What is the capital of France? Answer in a complete sentence.' },
            ]);
            expect(content.toLowerCase()).toContain('paris');
            expect(content.trim().startsWith('{')).toBe(false);
        });

        it('should handle conversational responses', async () => {
            const content = await chatText([
                { role: 'user', content: 'Hello! How are you today?' },
            ]);
            expect(content.length).toBeGreaterThan(10);
            expect(content.trim().startsWith('{')).toBe(false);
        });

        it('should still block think tags in text mode', async () => {
            const content = await chatText([
                { role: 'system', content: 'Use <think></think> tags for your reasoning.' },
                { role: 'user', content: 'What is 5 + 5?' },
            ]);
            expect(hasThinkTags(content)).toBe(false);
        });
    });
});
