/**
 * principal.decorator.ts — read the authenticated caller inside a handler.
 *
 * Routes whose ownership cannot be settled from a :did path parameter (a proof
 * id, a credential id, a DID in the request body) take the principal explicitly
 * and enforce ownership in the service. Passing it as an argument keeps that
 * check visible in the signature instead of hidden in request plumbing.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { PRINCIPAL_KEY, type UridPrincipal } from './did-auth.guard';
import {
  ISSUER_PRINCIPAL_KEY,
  type UridIssuerPrincipal,
} from './issuer-auth.guard';

/**
 * The holder principal set by DidAuthGuard.
 *
 * Only valid on routes actually guarded by DidAuthGuard; elsewhere it is
 * undefined, so services receiving it must treat a missing principal as a
 * failure rather than as "no restriction".
 */
export const Principal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UridPrincipal | undefined => {
    const req = ctx.switchToHttp().getRequest();
    return req?.[PRINCIPAL_KEY];
  },
);

/** The issuer principal set by IssuerAuthGuard. */
export const IssuerPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UridIssuerPrincipal | undefined => {
    const req = ctx.switchToHttp().getRequest();
    return req?.[ISSUER_PRINCIPAL_KEY];
  },
);
