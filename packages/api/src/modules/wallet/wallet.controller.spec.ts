/**
 * Wallet controller validation tests.
 *
 * Verifies that linkBodySchema + ZodValidationPipe are wired correctly:
 *   - malformed POST /wallet/link body → BadRequestException (HTTP 400)
 *   - well-formed body passes through unchanged
 *
 * Threat register coverage: T-08-05
 */

import { describe, it, expect } from 'vitest';
import { BadRequestException, ArgumentMetadata } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { linkBodySchema } from './wallet.dto';

const meta: ArgumentMetadata = { type: 'body', metatype: Object, data: '' };

describe('POST /wallet/link — linkBodySchema via ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(linkBodySchema);

  it('rejects an empty body with BadRequestException (HTTP 400)', () => {
    expect(() => pipe.transform({}, meta)).toThrow(BadRequestException);
  });

  it('rejects a body missing researcherDid', () => {
    expect(() =>
      pipe.transform({ address: '0xabc', chain: 'eth' }, meta),
    ).toThrow(BadRequestException);
  });

  it('rejects a body with an empty address', () => {
    expect(() =>
      pipe.transform({ researcherDid: 'did:ub:0xabc', address: '', chain: 'eth' }, meta),
    ).toThrow(BadRequestException);
  });

  it('rejects a body with an empty chain', () => {
    expect(() =>
      pipe.transform({ researcherDid: 'did:ub:0xabc', address: '0xabc', chain: '' }, meta),
    ).toThrow(BadRequestException);
  });

  it('passes a well-formed body without optional label', () => {
    const input = {
      researcherDid: 'did:ub:0xabc123',
      address: '0xDEADBEEF',
      chain: 'ethereum',
    };
    const result = pipe.transform(input, meta);
    expect(result).toEqual(input);
  });

  it('passes a well-formed body with optional label', () => {
    const input = {
      researcherDid: 'did:ub:0xabc123',
      address: '0xDEADBEEF',
      chain: 'ethereum',
      label: 'primary',
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
