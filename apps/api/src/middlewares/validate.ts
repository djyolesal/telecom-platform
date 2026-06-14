import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodEffects } from 'zod';

type Schema = AnyZodObject | ZodEffects<AnyZodObject>;

/**
 * Middleware de validation Zod. Valide et nettoie req.body / req.query / req.params.
 * Usage : router.post('/sites', validate({ body: createSiteSchema }), ctrl.createSite)
 */
export function validate(schemas: { body?: Schema; query?: Schema; params?: Schema }) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = await schemas.body.parseAsync(req.body);
      if (schemas.query) Object.assign(req.query, await schemas.query.parseAsync(req.query));
      if (schemas.params) Object.assign(req.params, await schemas.params.parseAsync(req.params));
      next();
    } catch (err) {
      next(err);
    }
  };
}
