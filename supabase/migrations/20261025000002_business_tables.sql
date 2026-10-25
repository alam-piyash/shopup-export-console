-- business tables
-- ===== Sequences & formatting =====
create sequence public.trade_code_seq;
create sequence public.exp_code_seq;
create sequence public.collection_code_seq;
create sequence public.incentive_code_seq;

create or replace function public.fmt_bdt(v numeric) returns text language sql immutable as $$
  select '৳' || to_char(coalesce(v,0), 'FM999,999,999,999,990.00')
$$;

-- ===== Business tables =====
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('TRD-' || lpad(nextval('public.trade_code_seq')::text, 4, '0')),
  exporter text not null,
  exporter_address text, exporter_phone text, exporter_email text,
  importer_name text not null,
  importer_country text not null,
  buyer_cr_no text, buyer_vat_no text, buyer_address text,
  notify_parties jsonb not null default '[]'::jsonb,
  products text not null default '',
  sales_contract_no text not null unique,
  contract_date date not null,
  shipping_mark text, country_of_origin text, country_of_destination text,
  expiry_date date, shipment_timeline text,
  carriage_by text check (carriage_by in ('Air','Sea','Road')),
  departure_port text, point_of_entry text,
  payment_type text, payment_terms text, tolerance_pct numeric(5,2),
  bank_name text, bank_branch text, bank_routing_no text, bank_swift text, bank_account_name text, bank_account_no text,
  incentive_terms text,
  notes text,
  contract_amount numeric(16,2) not null check (contract_amount > 0),
  contract_amount_usd numeric(14,2),
  exchange_rate numeric(12,4),
  currency text not null default 'BDT' check (currency in ('BDT','USD')),
  contract_extra jsonb not null default '{}'::jsonb,
  status public.trade_status not null default 'pending_approval',
  created_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trade_items (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trades(id) on delete cascade,
  sort_order int not null default 0,
  description text not null,
  carton_size text, hs_code text, incoterm text,
  quantity_kg numeric(14,3) not null check (quantity_kg > 0),
  rate_per_kg numeric(14,4) not null check (rate_per_kg > 0),
  rate_usd_per_kg numeric(14,4),
  line_total numeric(16,2) not null,
  is_demo boolean not null default false
);
create index on public.trade_items(trade_id);

create table public.trade_amendments (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trades(id) on delete cascade,
  amendment_no int not null check (amendment_no > 0),
  amendment_date date not null,
  reason text not null,
  old_amount numeric(16,2) not null,
  new_amount numeric(16,2) not null check (new_amount > 0),
  old_items jsonb, new_items jsonb,
  old_expiry_date date, new_expiry_date date,
  old_shipment_timeline text, new_shipment_timeline text,
  exp_changes jsonb not null default '[]'::jsonb,
  status public.approval_status not null default 'pending_approval',
  requested_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index trade_amendments_no_uniq on public.trade_amendments(trade_id, amendment_no) where status not in ('rejected','withdrawn');

create table public.exps (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('EXP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.exp_code_seq')::text, 4, '0')),
  trade_id uuid not null references public.trades(id) on delete cascade,
  shipment_id text, exp_no text, awb_no text, flight_no text, shipment_date date,
  amount numeric(16,2) not null check (amount > 0),
  amount_usd numeric(14,2),
  type public.exp_type not null default 'regular',
  status public.exp_status not null default 'open',
  created_by uuid not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index on public.exps(trade_id);

create table public.exp_documents (
  id uuid primary key default gen_random_uuid(),
  exp_id uuid not null references public.exps(id) on delete cascade,
  doc_type text not null,
  sort_order int not null,
  status public.doc_status not null default 'missing',
  file_path text, file_name text, file_size bigint,
  uploaded_by uuid, uploaded_at timestamptz,
  finalized_by uuid, finalized_at timestamptz,
  is_demo boolean not null default false,
  unique (exp_id, doc_type)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('trade_contract','trade_amendment','collection','incentive')),
  entity_id uuid not null,
  doc_type text not null,
  file_path text not null,
  file_name text not null,
  file_size bigint,
  uploaded_by uuid not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.attachments(entity_type, entity_id);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('COL-' || lpad(nextval('public.collection_code_seq')::text, 4, '0')),
  trade_id uuid not null references public.trades(id) on delete cascade,
  amount numeric(16,2) not null check (amount > 0),
  amount_usd numeric(14,2),
  bank_reference text,
  status public.approval_status not null default 'pending_approval',
  created_by uuid not null,
  approved_by uuid, approved_at timestamptz, rejection_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.collection_exps (
  collection_id uuid not null references public.collections(id) on delete cascade,
  exp_id uuid not null references public.exps(id) on delete cascade,
  amount numeric(16,2) not null,
  primary key (collection_id, exp_id)
);

create table public.incentives (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('INC-' || lpad(nextval('public.incentive_code_seq')::text, 4, '0')),
  exp_amount numeric(16,2) not null,
  net_proceed numeric(16,2) not null,
  freight numeric(16,2) not null,
  fob numeric(16,2) not null,
  incentive_pct numeric(7,3) not null,
  incentive_amount numeric(16,2) not null,
  net_proceed_usd numeric(14,2),
  freight_usd numeric(14,2),
  status public.approval_status not null default 'pending_approval',
  created_by uuid not null,
  approved_by uuid, approved_at timestamptz, rejection_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.incentive_exps (
  incentive_id uuid not null references public.incentives(id) on delete cascade,
  exp_id uuid not null references public.exps(id) on delete cascade,
  amount numeric(16,2) not null,
  primary key (incentive_id, exp_id)
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  trade_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.activity_log(trade_id, created_at desc);
create index on public.activity_log(created_at desc);

-- Grants: read for members, writes only through checked functions
do $$
declare t text;
begin
  foreach t in array array['trades','trade_items','trade_amendments','exps','exp_documents','attachments','collections','collection_exps','incentives','incentive_exps','activity_log'] loop
    execute format('grant select, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "Members read" on public.%I for select to authenticated using (public.is_member(auth.uid()))', t);
    execute format('create policy "Admins delete" on public.%I for delete to authenticated using (public.has_role(auth.uid(), ''admin''))', t);
  end loop;
end $$;
