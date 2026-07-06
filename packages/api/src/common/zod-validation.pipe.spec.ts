/**
 * ZodValidationPipe unit tests.
 *
 * Coverage:
 *   1. Valid object body → returns parsed value unchanged
 *   2. Missing required field → throws BadRequestException (HTTP 400)
 *   3. Wrong-typed field → throws BadRequestException
 *   4. Scalar string schema with empty string → throws BadRequestException
 *      (mirrors the @Param path used by the impact controller)
 *   5. Thrown exception payload contains a structured `errors` object, never a
 *      raw stack trace (mitigates T-08-02)
 *
 * Threat register coverage:
 *   T-08-01: malformed input never reaches service layer
 *   T-08-02: error response exposes only flattened Zod errors
 */

import { describe, it, expect } from 'vitest';
import { BadRequestException, ArgumentMetadata } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

// Minimal ArgumentMetadata stub — the pipe ignores metadata content but the
// PipeTransform interface requires it.
const meta: ArgumentMetadata = { type: 'body', metatype: Object, data: '' };
const paramMeta: ArgumentMetadata = { type: 'param', metatype: String, data: 'id' };

const BodySchema = z.object({
  name: z.string(),
  age: z.number(),
});

describe('ZodValidationPipe', () => {
  describe('object schema', () => {
    const pipe = new ZodValidationPipe(BodySchema);

    it('returns the parsed value when input is valid', () => {
      const input = { name: 'Alice', age: 30 };
      const result = pipe.transform(input, meta);
      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('throws BadRequestException when a required field is missing', () => {
      const input = { age: 30 }; // name is missing
      expect(() => pipe.transform(input, meta)).toThrow(BadRequestException);
    });

    it('throws BadRequestException when a field has the wrong type', () => {
      const input = { name: 'Alice', age: 'not-a-number' };
      expect(() => pipe.transform(input, meta)).toThrow(BadRequestException);
    });
  });

  describe('scalar string schema (@Param path)', () => {
    const pipe = new ZodValidationPipe(z.string().min(1));

    it('throws BadRequestException when value is an empty string', () => {
      expect(() => pipe.transform('', paramMeta)).toThrow(BadRequestException);
    });

    it('returns the parsed string when value is non-empty', () => {
      const result = pipe.transform('some-id', paramMeta);
      expect(result).toBe('some-id');
    });
  });

  describe('error response shape (T-08-02: no stack trace exposure)', () => {
    const pipe = new ZodValidationPipe(BodySchema);

    it('exception response contains a structured errors object and not a stack string', () => {
      const input = { age: 'wrong' }; // name missing, age wrong type

      let thrown: BadRequestException | undefined;
      try {
        pipe.transform(input, meta);
      } catch (err) {
        thrown = err as BadRequestException;
      }

      expect(thrown).toBeInstanceOf(BadRequestException);

      const response = thrown!.getResponse() as Record<string, unknown>;
      expect(response.message).toBe('Validation failed');

      // errors must be the Zod flatten() shape — an object with fieldErrors
      expect(typeof response.errors).toBe('object');
      expect(response.errors).not.toBeNull();
      const errors = response.errors as Record<string, unknown>;
      expect(errors).toHaveProperty('fieldErrors');
      expect(errors).toHaveProperty('formErrors');

      // Must NOT expose a raw stack string
      const responseStr = JSON.stringify(response);
      expect(responseStr).not.toContain('at Object.');
      expect(responseStr).not.toContain('.spec.ts');
    });
  });
});
