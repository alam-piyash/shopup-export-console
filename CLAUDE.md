# CLAUDE.md

Guide for any Claude session working on ShopUp Export Console.

## What this is

Internal tool for ShopUp's export business: trades, EXPs, amendments, collections,
incentives, admin approvals and an activity log. Only shopup.org Google accounts can sign in.

## Stack and accounts

All accounts belong to alam.piiyash@gmail.com.

| Piece | Where |
| --- | --- |
| Code | GitHub `piiyash-collab/shopup-export-console`, branch `main` |
| Frontend | React 18, Vite 5, TypeScript, Tailwind 3, TanStack Query, react-router 6 |
| Database, auth, files | Supabase project `shopup-export` (ref `jnjpwsjyswnsrendjodn`, region ap-southeast-1) |
| Hosting | Vercel project `shopup-export-console`, linked to the GitHub repo |

Lovable is retired. Never use the Lovable "ShopUp Export" project or Lovable Cloud.

## Change loop (follow every time)

1. Create a branch from `main` (for example `feat/short-name` or `fix/short-name`).
2. Edit code. Run `npm ci` once, then `npm run build` (typecheck plus build) before every commit. It must pass.
3. Commit and push the branch. Vercel builds a preview deploy for the branch automatically.
4. Open the preview URL and check the changed screens. Preview deploys use the same Supabase project, so do not create junk data there; use demo data or clean up after.
5. Open a pull request into `main`, then merge. Vercel deploys `main` to production.
6. Confirm the production deploy is Ready and the site loads.

## Database changes

- The source of truth is `supabase/migrations/`. Never edit an applied migration.
- Every change is a new file: `supabase/migrations/<YYYYMMDDHHMMSS>_<snake_name>.sql`.
- Apply it with the Supabase MCP `apply_migration` (same name, same SQL) or `supabase db push`.
- Apply the migration before merging code that depends on it, since previews and production share one database. Keep migrations backward compatible (add first, remove later).
- Ask the user before anything destructive: dropping tables or columns, deleting rows, truncating, removing the storage bucket.
- `supabase/schema.sql` is the original single-file schema, kept for reference only.

## Rules baked into the database

All writes go through security-definer RPC functions; tables are read-only for members under RLS.
Domain enforcement lives in a trigger on `auth.users` using `app_settings.allowed_domain`.
The bootstrap admin is `app_settings.bootstrap_admin_email` (tasnim.piyash@shopup.org); the first
person to sign in also becomes admin. Files live in the private `documents` storage bucket and are
opened through short-lived signed URLs.

## Secrets

- Never commit secrets. `.env*.local` is git-ignored.
- Frontend env vars live only in Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ALLOWED_DOMAIN`.
- The Google OAuth client secret lives only in Supabase Auth settings.
- Never use or print the Supabase service role key in the frontend.

## Writing style for this user

No em dashes or long dashes in anything written for the user. Use commas, periods or parentheses.
