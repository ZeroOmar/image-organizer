import { FileRefSchema } from '@io/shared';
import { z } from 'zod';
import { HttpError } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '));
  }
  return r.data;
}

/** ?root=media&rel=Trips/Bikers */
export const RefQuery = z.object({ root: FileRefSchema.shape.root, rel: z.string().default('') });
