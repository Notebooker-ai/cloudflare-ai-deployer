import { describe, it, expect } from 'vitest';
import { repairJson } from '../workers/template-unified.js';

describe('repairJson', () => {
    describe('Valid JSON passthrough', () => {
        it('should return valid JSON unchanged', () => {
            const valid = '{"key": "value"}';
            expect(repairJson(valid)).toBe(valid);
        });

        it('should return empty object unchanged', () => {
            const valid = '{}';
            expect(repairJson(valid)).toBe(valid);
        });

        it('should return array unchanged', () => {
            const valid = '[1, 2, 3]';
            expect(repairJson(valid)).toBe(valid);
        });

        it('should return null/undefined unchanged', () => {
            expect(repairJson(null)).toBe(null);
            expect(repairJson(undefined)).toBe(undefined);
            expect(repairJson('')).toBe('');
        });
    });

    describe('Adjacent quotes repair', () => {
        it('should fix adjacent double quotes (model bug)', () => {
            const malformed = '{"description":"Trump speech.""Really emphasize"}';
            const result = repairJson(malformed);
            expect(() => JSON.parse(result)).not.toThrow();
        });

        it('should fix adjacent quotes with text after', () => {
            const malformed = '{"key":"value""next text"}';
            const result = repairJson(malformed);
            expect(() => JSON.parse(result)).not.toThrow();
        });

        it('should fix multiple adjacent quote issues', () => {
            const malformed = '{"a":"one""two","b":"three""four"}';
            const result = repairJson(malformed);
            expect(() => JSON.parse(result)).not.toThrow();
        });
    });

    describe('Missing comma repair', () => {
        it('should fix missing comma between properties', () => {
            const malformed = '{"key1": "value1" "key2": "value2"}';
            const result = repairJson(malformed);
            expect(() => JSON.parse(result)).not.toThrow();
        });

        it('should handle multiple missing commas', () => {
            const malformed = '{"a": "1" "b": "2" "c": "3"}';
            const result = repairJson(malformed);
            expect(() => JSON.parse(result)).not.toThrow();
        });
    });

    describe('Trailing comma repair', () => {
        it('should fix trailing comma before closing brace', () => {
            const malformed = '{"key": "value",}';
            const result = repairJson(malformed);
            expect(() => JSON.parse(result)).not.toThrow();
            expect(JSON.parse(result)).toEqual({ key: 'value' });
        });

        it('should fix trailing comma before closing bracket', () => {
            const malformed = '{"items": [1, 2, 3,]}';
            const result = repairJson(malformed);
            expect(() => JSON.parse(result)).not.toThrow();
        });

        it('should fix nested trailing commas', () => {
            const malformed = '{"obj": {"nested": "value",},}';
            const result = repairJson(malformed);
            expect(() => JSON.parse(result)).not.toThrow();
        });
    });

    describe('Complex malformed JSON', () => {
        it('should handle adjacent quotes in nested structure', () => {
            const malformed = '{"segments":[{"name":"Intro","description":"Welcome.""Today we discuss AI.","size":"short"}]}';
            const result = repairJson(malformed);
            expect(() => JSON.parse(result)).not.toThrow();
        });

        it('should return original if repair fails', () => {
            const broken = 'this is not json at all';
            const result = repairJson(broken);
            expect(result).toBe(broken);
        });
    });
});
