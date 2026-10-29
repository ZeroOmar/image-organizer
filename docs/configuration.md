# Configuration

## Static config: `APP_CONFIG`

Multi-line YAML in the `APP_CONFIG` env var. At startup:

1. Read `/app/config.yaml` if it exists.
2. Deep-merge `APP_CONFIG` over it. **The env value wins** on any conflicting key; keys only in the file are kept; arrays are replaced, not merged.
3. Validate with `ConfigSchema` (`apps/server/src/config/schema.ts`). Errors list each bad path and stop startup.
4. Write the merged YAML back to `/app/config.yaml` (mode 600).

If neither exists, startup fails with "No configuration".

```yaml
admin:
  username: admin
  passwordHash: "$2b$12$..."     # bcrypt; `hash-password` generates it
session:
  secret: "at least 16 chars"    # signs the session cookie
  ttlHours: 24
server:                          # optional
  host: 0.0.0.0
  port: 80                       # PORT env overrides
media:   { root: /media }
import:  { root: /import, maxUploadMB: 2048 }
trash:   { root: /trash, retentionDays: 30 }   # 0 = never auto-purge
timezone: { default: Africa/Cairo }             # IANA zone or +03:00
map:
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
  attribution: "© OpenStreetMap contributors"
  nominatimUrl: "https://nominatim.openstreetmap.org"
```

The Settings page shows this config read-only, with secrets masked (`GET /api/config/static`).

## Env vars

| Var | Default | |
|---|---|---|
| `APP_CONFIG` | — | YAML above |
| `APP_DIR` | `/app` | Config/data/cache directory |
| `PORT` | config | Overrides `server.port` |
| `PUID` / `PGID` | 1000 | The entrypoint drops root to this user (via `su-exec`); only `/app` is chown'ed |
| `TZ` | — | Container clock only; the app uses `timezone.default` |
| `WEB_DIST` | `apps/web/dist` | Built web assets |

## Compose

See [../docker-compose.example.yml](../docker-compose.example.yml) (copy it to the git-ignored `docker-compose.yml`): an external `internal` network, a bind-mounted `config` volume, NFS volumes for media/import/trash, and Traefik labels. In compose files **escape `$` as `$$`** in the password hash.

## Dynamic settings

`SettingsSchema` (`packages/shared/src/settings.ts`), stored in SQLite and edited on the Settings page: date-source priority, rename templates/type labels/counter, extension map, issue highlighting, and a trash retention override. Adding a field: add it to the schema with a default (`.prefault({})` for nested objects in zod 4), then add UI in `apps/web/src/pages/Settings.tsx`.

## Local runs

`scripts/run-local.sh` writes `.local-test/app-config.yaml` (admin/admin, sandbox roots, port 8080) and exports it as `APP_CONFIG`.
