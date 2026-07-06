/**
 * ZodValidationPipe — reusable NestJS pipe that validates a value against a
 * Zod schema and throws a structured HTTP 400 on failure.
 *
 * Usage (per-route, not global):
 *   @Get(':id')
 *   find(@Param('id', new ZodValidationPipe(z.string().uuid())) id: string) { ... }
 *
 *   @Post()
 *   create(@Body(new ZodValidationPipe(CreateBodySchema)) dto: CreateBodyDto) { ... }
 *
 * Threat register coverage:
 *   T-08-01: rejects malformed bodies/params with 400 before DB/crypto work executes
 *   T-08-02: only Zod's flattened fieldErrors/formErrors exposed — no stack traces
 */

import { BadRequestException, PipeTransform, ArgumentMetadata } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.flatten(),
      });
    }

    return result.data;
  }
}
