import { isValidZone } from '@io/shared';
import { z } from 'zod';

/** Static config: APP_CONFIG (env, multi-line YAML) merged over /app/config.yaml. */
export const ConfigSchema = z.object({
  admin: z.object({
    username: z.string().min(1),
    passwordHash: z.string().regex(/^\$2[aby]\$\d{2}\$.{53}$/, 'must be a bcrypt hash (run hash-password)'),
  }),
  session: z
    .object({
      secret: z.string().min(16, 'must be at least 16 characters'),
      ttlHours: z.number().positive().default(24),
    }),
  server: z
    .object({
      port: z.number().int().positive().default(80),
      host: z.string().default('0.0.0.0'),
    })
    .prefault({}),
  media: z.object({ root: z.string().default('/media') }).prefault({}),
  import: z
    .object({
      root: z.string().default('/import'),
      maxUploadMB: z.number().positive().default(2048),
    })
    .prefault({}),
  trash: z
    .object({
      root: z.string().default('/trash'),
      retentionDays: z.number().int().min(0).default(30),
    })
    .prefault({}),
  timezone: z
    .object({
      default: z.string().refine(isValidZone, 'unknown timezone').default('UTC'),
    })
    .prefault({}),
  map: z
    .object({
      tileUrl: z.string().default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
      attribution: z.string().default('© OpenStreetMap contributors'),
      nominatimUrl: z.string().default('https://nominatim.openstreetmap.org'),
    })
    .prefault({}),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
