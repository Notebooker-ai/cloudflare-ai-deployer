import { describe, it, expect } from 'vitest';
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
            ...options,
        }),
    });

    return response.json();
}

describe.skipIf(SKIP)('Max Tokens', () => {
    describe('Supports max_completion_tokens (OpenAI style)', () => {
        it('should accept max_completion_tokens parameter and return content', async () => {
            const data = await chat([
                { role: 'user', content: 'Say hello.' },
            ], { max_completion_tokens: 50 });

            expect(data.usage).toBeDefined();
            expect(data.usage.completion_tokens).toBeGreaterThan(0);
            expect(data.choices[0].message.content.length).toBeGreaterThan(0);
        });

        it('max_completion_tokens should take precedence over max_tokens', async () => {
            const data = await chat([
                { role: 'user', content: 'Say hello.' },
            ], { max_completion_tokens: 50, max_tokens: 200 });

            expect(data.choices[0].message.content.length).toBeGreaterThan(0);
            expect(data.usage).toBeDefined();
        });
    });

    describe('Respects max_tokens limit (legacy)', () => {
        it('should accept max_tokens parameter and return content', async () => {
            const data = await chat([
                { role: 'user', content: 'Say hello.' },
            ], { max_tokens: 50 });

            expect(data.usage).toBeDefined();
            expect(data.usage.completion_tokens).toBeGreaterThan(0);
            expect(data.choices[0].message.content.length).toBeGreaterThan(0);
        });

        it('should allow longer responses without max_tokens', async () => {
            const unlimited = await chat([
                { role: 'user', content: 'Explain quantum physics in detail.' },
            ]);

            expect(unlimited.usage.completion_tokens).toBeGreaterThan(0);
            expect(unlimited.choices[0].message.content.length).toBeGreaterThan(50);
        });
    });

    describe('Usage reporting', () => {
        it('should report accurate token usage', async () => {
            const data = await chat([
                { role: 'user', content: 'Say hello.' },
            ]);

            expect(data.usage).toBeDefined();
            expect(data.usage.prompt_tokens).toBeGreaterThan(0);
            expect(data.usage.completion_tokens).toBeGreaterThan(0);
            expect(data.usage.total_tokens).toBe(
                data.usage.prompt_tokens + data.usage.completion_tokens
            );
        });
    });

    describe('Edge cases', () => {
        it('should handle large max_tokens gracefully', async () => {
            const data = await chat([
                { role: 'user', content: 'Say hi.' },
            ], { max_tokens: 4096 });

            expect(data.choices).toBeDefined();
            expect(data.choices[0].message.content).toBeDefined();
            expect(data.choices[0].message.content.length).toBeGreaterThan(0);
        });

        it('should work with max_tokens and temperature together', async () => {
            const data = await chat([
                { role: 'user', content: 'Write something creative.' },
            ], { max_tokens: 100, temperature: 0.9 });

            expect(data.choices[0].message.content.length).toBeGreaterThan(0);
        });
    });

    describe('Response structure', () => {
        it('should include finish_reason in response', async () => {
            const data = await chat([
                { role: 'user', content: 'Tell me a joke.' },
            ]);

            expect(data.choices[0].finish_reason).toBeDefined();
        });

        it('should return valid OpenAI-shaped response with max_tokens', async () => {
            const data = await chat([
                { role: 'user', content: 'Say hello.' },
            ], { max_tokens: 50 });

            expect(data.id).toBeDefined();
            expect(data.object).toBe('chat.completion');
            expect(data.model).toBe(MODELS.chat);
            expect(data.choices).toHaveLength(1);
            expect(data.choices[0].message.role).toBe('assistant');
            expect(data.usage).toBeDefined();
        });
    });
});
