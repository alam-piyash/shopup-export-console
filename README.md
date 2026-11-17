# ShopUp Export Console

Trade lifecycle management for ShopUp's export business: trades (sales contracts), EXPs per
shipment with their documents, contract amendments, collections and export incentives, with
approvals and a full activity trail. Supplier payments and expenses stay in CRT; GRN stays in
ShopUp's WMS and OMS.

## Architecture

```
browser ── Next.js (web/) ──► /api/* ──► Go API (api/) ──► Postgres (Supabase)
   │                                         │                 business functions, RLS
   └── Google sign-in (Supabase Auth)        └── Supabase Storage (signed links)
```

| Part | Stack | Folder |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind 3, TanStack Query | `web/` |
| Backend | Go 1.24, chi, lib/pq, golang-jwt | `api/` |
| Database | Postgres on Supabase: tables, views, RLS, security-definer business functions | `supabase/migrations/` |
| Sign-in and files | Supabase Auth (Google, shopup.org and silq.net only), Supabase Storage (private bucket) | |
| Hosting | One Vercel project with two Services: `web` at `/`, `api` at `/api` | `vercel.json` |

**Where the rules live.** The business rules (EXP numbering and uniqueness, locked fields,
contract limits, payment allocation, approvals, document versions, activity log) are Postgres
functions in `supabase/migrations/`. The Go API verifies the user's token, then runs every request
in a transaction that acts as that user (`role authenticated` plus the JWT claims), so the same
RLS policies and functions apply as before. The API layer is deliberately thin: moving a rule
from SQL into Go later is a change inside one handler.

API reference: [docs/API.md](docs/API.md). Deploying: [DEPLOY.md](DEPLOY.md).

## Run locally

Needs Go 1.24+, Node 22+ and Postgres.

```bash
# 1. API
cd api
cp .env.example .env        # point DATABASE_URL at a database with the migrations applied
set -a; . ./.env; set +a
go run ./cmd/api            # http://127.0.0.1:8080/api/health

# 2. Frontend (another terminal)
cd web
cp .env.example .env.local  # Supabase URL and anon key for sign-in, API_DEV_URL=http://127.0.0.1:8080
npm ci
npm run dev                 # http://localhost:3000
```

In development Next.js forwards `/api/*` to `API_DEV_URL`. On Vercel the Services rewrite in
`vercel.json` sends `/api/*` to the Go service.

### Local test database

The Go integration test runs the full trade flow (masters, trade, approval, signed contract,
EXP, 8 documents and auto close, follow-up, collection, incentive, access checks) through the
HTTP API against a real Postgres:

```bash
# a database with Supabase's auth/storage schemas (or local stubs) and every migration applied,
# plus the bootstrap admin in auth.users
TEST_DATABASE_URL='postgres://postgres:local@localhost:5432/export_local?sslmode=disable' \
  go test ./...
```

Without `TEST_DATABASE_URL` the integration test is skipped and only the unit tests run
(token verification, storage paths).

## Project layout

```
api/cmd/api              Go entrypoint (HTTP server, reads PORT)
api/internal/auth        Supabase token verification (JWKS, HS256, Auth fallback)
api/internal/db          per-user transactions, JSON queries, business function calls
api/internal/httpapi     routes: reads.go, writes.go, files.go
api/internal/storage     signed upload and download links
web/src/app              Next.js routes (one page.tsx per screen)
web/src/views            screens
web/src/components       shell, UI kit, documents, dialogs
web/src/lib              API client (http.ts), data hooks (api.ts), routing helpers, formatting
supabase/migrations      database schema and business functions (source of truth)
docs/API.md              endpoint reference
```
