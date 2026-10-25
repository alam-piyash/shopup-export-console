# Deploying ShopUp Export Console

## How deploys happen

| Event | Result |
| --- | --- |
| Push to any branch except `main` | Vercel preview deploy (unique URL per branch and commit) |
| Merge or push to `main` | Vercel production deploy at https://shopup-export-console.vercel.app |

Nobody uploads files by hand. Vercel project: `alampiiyash-1378s-projects/shopup-export-console`, connected to GitHub `alam-piyash/shopup-export-console`. Vercel runs `npm run build` and serves `dist/` (see `vercel.json`).

## Environment variables (Vercel, all environments)

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://jnjpwsjyswnsrendjodn.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable (anon) key, from Supabase > Project Settings > API |
| `VITE_ALLOWED_DOMAIN` | `shopup.org` |

These are baked in at build time, so redeploy after changing them.

## Database

Migrations in `supabase/migrations/` are applied in filename order. To set up a fresh project,
apply them all in order. To change the schema, add a new migration file (see CLAUDE.md).

## Google sign-in

Google OAuth client (Google Cloud > Google Auth Platform > Clients, type Web application):

- Authorized JavaScript origins: `https://shopup-export-console.vercel.app`, `http://localhost:5173`
- Authorized redirect URI: `https://jnjpwsjyswnsrendjodn.supabase.co/auth/v1/callback`

Supabase > Authentication:

- Sign In / Providers > Google: enabled, with the Client ID and Client Secret from Google
- URL Configuration > Site URL: `https://shopup-export-console.vercel.app`
- URL Configuration > Redirect URLs:
  - `https://shopup-export-console.vercel.app/**`
  - `https://shopup-export-console-*-alampiiyash-1378s-projects.vercel.app/**` (branch previews)
  - `http://localhost:5173/**`

## Local development

```bash
npm ci
cp .env.example .env.local   # fill in the three values above
npm run dev                  # http://localhost:5173
npm run build                # must pass before every commit
```

## Rollback

In Vercel > Deployments, open the last good production deploy and choose Promote to Production
(instant rollback). Database migrations are not rolled back automatically; write a new migration
that reverses the change.
