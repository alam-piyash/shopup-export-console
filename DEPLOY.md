# Deploying ShopUp Export Console

## How deploys happen

| Event | Result |
| --- | --- |
| Push to any branch except `main` | Vercel preview deploy (web and API together, one URL) |
| Merge or push to `main` | Vercel production deploy at https://shopup-export-console.vercel.app |

`vercel.json` defines two Vercel Services in one project: `web` (Next.js, `web/`) serves every
path, `api` (Go, `api/`) serves `/api/*`. Services and the Go runtime are in Beta on all Vercel
plans. If a build fails with a framework error, set Project Settings > Build and Deployment >
Framework Preset to **Other** (the services define their own frameworks).

## Environment variables (Vercel, all environments)

| Name | Used by | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | web | `https://jnjpwsjyswnsrendjodn.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | Supabase publishable (anon) key |
| `NEXT_PUBLIC_ALLOWED_DOMAIN` | web | `shopup.org,silq.net` |
| `DATABASE_URL` | api | Supabase > Connect > Transaction pooler (port 6543), with the database password |
| `SUPABASE_URL` | api | same as `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | api | same as `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SUPABASE_JWT_SECRET` | api | optional, only for legacy HS256 tokens |

`NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them. The old
`VITE_*` variables are no longer used and can be deleted once the new build is live.
`DATABASE_URL` is a secret: add it as a sensitive variable and never commit it.

## Database

Migrations in `supabase/migrations/` are applied in filename order. The Go API needs no schema
change: it calls the same functions the old frontend called.

## Google sign-in

Unchanged. Supabase > Authentication > URL Configuration must list the app URLs:

- Site URL: `https://shopup-export-console.vercel.app`
- Redirect URLs: `https://shopup-export-console.vercel.app/**`,
  `https://shopup-export-console-*-alampiiyash-1378s-projects.vercel.app/**` (previews),
  `http://localhost:3000/**` (local Next.js)

## Check a deploy

1. `https://<deploy-url>/api/health` returns `{"status":"ok"}` (database reachable).
2. Sign in, open Dashboard, Trades, an EXP and Collections.
3. Upload a document version and open it (storage links).

## Rollback

Vercel > Deployments > last good production deploy > Promote to Production. Database
migrations are not rolled back automatically; write a new migration that reverses the change.
