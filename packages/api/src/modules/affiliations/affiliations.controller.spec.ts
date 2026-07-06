/**
 * Affiliations controller validation tests.
 *
 * Verifies that requestBodySchema + ZodValidationPipe are wired correctly:
 *   - malformed POST /affiliations/request body → BadRequestException (HTTP 400)
 *   - well-formed body passes through unchanged
 *
 * Threat register coverage: T-08-05
 */

import { describe, it, expect } from 'vitest';
import { BadRequestException, ArgumentMetadata } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { requestBodySchema } from './affiliations.dto';

const meta: ArgumentMetadata = { type: 'body', metatype: Object, data: '' };

describe('POST /affiliations/request — requestBodySchema via ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(requestBodySchema);

  it('rejects a body missing all required fields with BadRequestException (HTTP 400)', () => {
    expect(() => pipe.transform({}, meta)).toThrow(BadRequestException);
  });

  it('rejects a body with a missing researcherDid', () => {
    expect(() =>
      pipe.transform({ organizationName: 'MIT', role: 'author' }, meta),
    ).toThrow(BadRequestException);
  });

  it('rejects a body with an empty researcherDid', () => {
    expect(() =>
      pipe.transform({ researcherDid: '', organizationName: 'MIT', role: 'author' }, meta),
    ).toThrow(BadRequestException);
  });

  it('rejects a body with an empty organizationName', () => {
    expect(() =>
      pipe.transform(
        { researcherDid: 'did:ub:0xabc', organizationName: '', role: 'author' },
        meta,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a body with an empty role', () => {
    expect(() =>
      pipe.transform(
        { researcherDid: 'did:ub:0xabc', organizationName: 'MIT', role: '' },
        meta,
      ),
    ).toThrow(BadRequestException);
  });

  it('passes a well-formed body through unchanged', () => {
    const input = {
      researcherDid: 'did:ub:0xabc123',
      organizationName: 'MIT',
      role: 'author',
    };
    const result = pipe.transform(input, meta);
    expect(result).toEqual(input);
  });

  it('BadRequestException response contains Zod fieldErrors (no stack trace)', () => {
    let thrown: BadRequestException | undefined;
    try {
      pipe.transform({}, meta);
    } catch (err) {
      thrown = err as BadRequestException;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    const response = thrown!.getResponse() as Record<string, unknown>;
    expect(response.message).toBe('Validation failed');
    const errors = response.errors as Record<string, unknown>;
    expect(errors).toHaveProperty('fieldErrors');
    expect(JSON.stringify(response)).not.toContain('at Object.');
  });
});
