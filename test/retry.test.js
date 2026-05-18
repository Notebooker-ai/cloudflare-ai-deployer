import { describe, it, expect, vi } from 'vitest';
import { retryAIRun } from '../workers/template-unified.js';

function makeEnv(aiRunFn) {
    return { AI: { run: aiRunFn } };
}

describe('retryAIRun', () => {
    it('should succeed on first attempt', async () => {
        const env = makeEnv(vi.fn().mockResolvedValue({ response: 'ok' }));
        const result = await retryAIRun(env, '@cf/test/model', { messages: [] });
        expect(result).toEqual({ response: 'ok' });
        expect(env.AI.run).toHaveBeenCalledTimes(1);
    });

    it('should retry on 3030 error and succeed', async () => {
        const aiRun = vi.fn()
            .mockRejectedValueOnce(new Error('3030: Internal Server Error'))
            .mockResolvedValueOnce({ response: 'recovered' });

        const env = makeEnv(aiRun);
        const result = await retryAIRun(env, '@cf/test/model', { messages: [] });
        expect(result).toEqual({ response: 'recovered' });
        expect(aiRun).toHaveBeenCalledTimes(2);
    });

    it('should retry on "internal server error" (case-insensitive)', async () => {
        const aiRun = vi.fn()
            .mockRejectedValueOnce(new Error('Internal Server Error'))
            .mockResolvedValueOnce({ response: 'ok' });

        const env = makeEnv(aiRun);
        const result = await retryAIRun(env, '@cf/test/model', { messages: [] });
        expect(result).toEqual({ response: 'ok' });
        expect(aiRun).toHaveBeenCalledTimes(2);
    });

    it('should retry on "overloaded" error', async () => {
        const aiRun = vi.fn()
            .mockRejectedValueOnce(new Error('Server overloaded'))
            .mockResolvedValueOnce({ response: 'ok' });

        const env = makeEnv(aiRun);
        const result = await retryAIRun(env, '@cf/test/model', { messages: [] });
        expect(result).toEqual({ response: 'ok' });
        expect(aiRun).toHaveBeenCalledTimes(2);
    });

    it('should NOT retry non-transient errors', async () => {
        const aiRun = vi.fn()
            .mockRejectedValueOnce(new Error('model not found'));

        const env = makeEnv(aiRun);
        await expect(retryAIRun(env, '@cf/test/model', { messages: [] }))
            .rejects.toThrow('model not found');
        expect(aiRun).toHaveBeenCalledTimes(1);
    });

    it('should throw after exhausting all retries', async () => {
        const aiRun = vi.fn()
            .mockRejectedValue(new Error('3030: Internal Server Error'));

        const env = makeEnv(aiRun);
        await expect(retryAIRun(env, '@cf/test/model', { messages: [] }, 3))
            .rejects.toThrow('3030: Internal Server Error');
        expect(aiRun).toHaveBeenCalledTimes(3);
    });

    it('should pass cfModel and modelOptions through to env.AI.run', async () => {
        const aiRun = vi.fn().mockResolvedValue({ response: 'ok' });
        const env = makeEnv(aiRun);
        const opts = { messages: [{ role: 'user', content: 'hi' }], stream: false };

        await retryAIRun(env, '@cf/meta/llama', opts);
        expect(aiRun).toHaveBeenCalledWith('@cf/meta/llama', opts);
    });

    it('should respect custom maxRetries', async () => {
        const aiRun = vi.fn()
            .mockRejectedValue(new Error('service unavailable'));

        const env = makeEnv(aiRun);
        await expect(retryAIRun(env, '@cf/test/model', {}, 5))
            .rejects.toThrow('service unavailable');
        expect(aiRun).toHaveBeenCalledTimes(5);
    });
});
