/**
 * Zod DTO schema for the impact controller's write endpoint param.
 *
 * Threat register coverage:
 *   T-08-06: rejects empty/blank :did path params with 400 so malformed identifiers
 *            cannot reach the impact-score compute path
 *
 * Impact has no request bodies — its only write endpoint (POST :did/calculate) is
 * param-only. Validating this param completes 6-of-6 controller coverage for HRD-01.
 */

import { z } from 'zod';

/** :did path param for POST /impact/:did/calculate */
export const didParamSchema = z.string().min(1, 'did param is required');
