# ShopUp Export Console

Internal tool for ShopUp's export business: trades (sales contracts), EXPs per shipment with six tracked documents, contract amendments, collections and export incentives, with admin approvals and a full activity trail.

Stack: React + Vite + TypeScript + Tailwind on the front end, Supabase (Postgres, Auth with Google, Storage) on the back end, deployed as a static site on Vercel. All business rules live in the database as checked functions with Row Level Security, so the browser can never bypass them.

## What's inside

| Area | What it does |
|---|---|
| Overview | KPIs, money flow (contracted, EXP issued, collected, incentive), needs-attention list, contracts expiring soon, admin approval queue, recent activity, top buyers |
| Trades | Create from a sales contract (items, buyer, notify parties, bank, contract copy). Admin approves or rejects. Close when every EXP is closed. CSV export |
| Amendments | Revise an active trade: new amount or item lines, expiry, timeline, open EXP amounts. Admin approves (applied atomically) or rejects. Submitter can withdraw |
| EXPs | One per shipment, regular or advance. Total can never exceed the contract. Six documents: upload, mark final, auto close at 6/6 and lock the amount. Cross-trade EXP list with filters |
| Collections | Amount received must equal the selected EXPs exactly (auto match helper). PRC, Ka Form, Swift Copy, TT Voucher required. Admin approves |
| Incentives | From EXPs in approved collections. FOB = net proceed minus freight, incentive = FOB x %. Eight documents required. Admin approves |
| Access control | Only your Google Workspace domain can sign in. First sign in gets Operation. Pre-assign Admin or Operation by email. Last admin is protected. Remove demo data |
| Everywhere | Ctrl K search, notifications, dark and light mode, mobile layout, BDT with lakh/crore grouping, optional USD alongside |

## Setup (about 15 minutes)

### 1. Supabase project

1. Create a project at https://supabase.com (region Singapore is closest to Dhaka).
2. Apply every file in `supabase/migrations/` in filename order (Supabase MCP `apply_migration` or `supabase db push`). See DEPLOY.md and CLAUDE.md.
3. Optional: run `supabase/seed_demo.sql` for sample data (admins can remove it later from Access control).
4. If your bootstrap admin or domain differs, run:
   ```sql
   update public.app_settings set allowed_domain = 'shopup.org', bootstrap_admin_email = 'tasnim.piyash@shopup.org';
   ```
   The bootstrap email always becomes Admin on first sign in. If no admin exists yet, the first person to sign in becomes Admin.

### 2. Google sign in

1. Google Cloud Console > APIs & Services > Credentials > **Create OAuth client ID** (Web application).
2. Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. In Supabase: **Authentication > Sign In / Providers > Google**, enable it and paste the Client ID and Secret.
4. In Supabase: **Authentication > URL Configuration**
   - Site URL: your Vercel URL, e.g. `https://shopup-export-console.vercel.app`
   - Redirect URLs: add `https://shopup-export-console.vercel.app/**` and `http://localhost:5173/**`

The app asks Google for the `shopup.org` workspace, and the database refuses any other domain, so outside accounts can't get in.

### 3. Deploy on Vercel

1. Push this folder to a GitHub repo (or run `npx vercel` inside it).
2. Import it in Vercel. Framework preset: **Vite** (already set in `vercel.json`).
3. Add environment variables (Supabase > Project Settings > API):
   - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the anon public key
   - `VITE_ALLOWED_DOMAIN` = `shopup.org`
4. Deploy. Put the final URL back into Supabase URL Configuration (step 2.4).

### 4. Run locally

```bash
cp .env.example .env   # fill in the values
npm install
npm run dev            # http://localhost:5173
```

## Rules enforced by the database

- Writes only happen through security-definer functions; tables are read-only for signed-in members.
- EXP total per trade can never exceed the contract amount (checked on insert, update and amendment approval).
- A closed EXP's amount is locked. Advance EXPs need a shipment ID before documents can be uploaded.
- An EXP can be in only one pending or approved collection, and one pending or approved incentive.
- Collection amount must equal the selected EXPs to the paisa; incentives only use EXPs from approved collections.
- One pending amendment per trade; amendment numbers are unique per trade.
- Every action is written to `activity_log`. Files live in a private `documents` bucket and open through short-lived signed links.

## Project layout

```
supabase/migrations/     database migrations (source of truth)
supabase/schema.sql      original single-file schema, reference only
supabase/seed_demo.sql   optional demo data
src/lib                  supabase client, data hooks, formatting, types
src/components           shell, UI kit, file upload, items editor, EXP dialogs
src/pages                one file per screen
```
