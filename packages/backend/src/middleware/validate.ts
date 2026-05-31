/**
 * Request validation middleware.
 *
 * `validate({ body, params, query })` parses the named request parts with the
 * given Zod schemas and REPLACES them with the parsed (typed, coerced) values
 * so downstream handlers read validated data. On failure it throws an
 * `AppError(VALIDATION_ERROR)` carrying structured `fieldViolations`, which
 * the global `errorHandlerMiddleware` renders.
 *
 * Throwing synchronously is safe: Express 4 forwards synchronous throws from
 * middleware to the error handler (only async rejections need `asyncHandler`).
 *
 *   router.post('/', validate({ body: CreateTriggerBody }), asyncHandler(handler));
 */

import type { Response, NextFunction } from 'express';
import { ZodError, type ZodType } from 'zod';
import type { AuthenticatedRequest } from '../types/index.js';
import { AppError, ErrorCode } from '../libs/http/index.js';

interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

function fieldViolations(err: ZodError): Array<{ field: string; description: string }> {
  return err.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    description: issue.message,
  }));
}

export function validate(schemas: ValidationSchemas) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        // req.query is a getter-only property on some Express setups; assign
        // the parsed result onto it defensively.
        Object.assign(req.query, schemas.query.parse(req.query));
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(
          new AppError(ErrorCode.VALIDATION_ERROR, 'Request validation failed', {
            details: { fieldViolations: fieldViolations(err) },
          })
        );
        return;
      }
      next(err);
    }
  };
}
