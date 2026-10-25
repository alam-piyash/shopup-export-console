-- =====================================================================
-- ShopUp Export Console: full database schema (run once on a fresh Supabase project)
-- REFERENCE ONLY. The source of truth is supabase/migrations/. Change the schema with new migration files.
-- BDT is the main currency. Optional USD columns are informational only.
-- =====================================================================

-- ===== Types =====
create type public.app_role as enum ('operation','admin');
create type public.trade_status as enum ('pending_approval','active','revision_pending','closed','rejected');
create type public.approval_status as enum ('pending_approval','approved','rejected','withdrawn');
create type public.exp_type as enum ('regular','advance');
create type public.exp_status as enum ('open','closed');
create type public.doc_status as enum ('missing','uploaded','final');

-- ===== App settings (allowed domain, bootstrap admin) =====
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  allowed_domain text not null default 'shopup.org',
  bootstrap_admin_email text not null default 'tasnim.piyash@shopup.org'
);
insert into public.app_settings default values;
alter table public.app_settings enable row level security;
grant select on public.app_settings to authenticated, anon;
create policy "Anyone reads settings" on public.app_settings for select using (true);

create or replace function public.allowed_domain() returns text
language sql stable security definer set search_path = public as $$
  select lower(allowed_domain) from public.app_settings where id = 1
$$;

-- ===== Profiles & roles =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now()
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create table public.role_preassignments (
  email text primary key,
  full_name text,
  role public.app_role not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select on public.role_preassignments to authenticated;
grant all on public.role_preassignments to service_role;
alter table public.role_preassignments enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_member(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id)
    and exists (select 1 from public.profiles where id = _user_id and lower(email) like '%@' || public.allowed_domain())
$$;

create or replace function public.require_member() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_member(auth.uid()) then
    raise exception 'You do not have access to ShopUp Export Console';
  end if;
end $$;

create or replace function public.require_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can do this';
  end if;
end $$;

create policy "Members read profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_member(auth.uid()));
create policy "Read own role or admin reads all" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "Admins read preassignments" on public.role_preassignments for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ===== Auth triggers =====
create or replace function public.enforce_domain() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or lower(new.email) not like '%@' || public.allowed_domain() then
    raise exception 'Only % accounts can sign in to ShopUp Export Console', public.allowed_domain();
  end if;
  return new;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pre public.role_preassignments; v_role public.app_role := 'operation'; v_boot text;
begin
  select lower(bootstrap_admin_email) into v_boot from public.app_settings where id = 1;
  select * into v_pre from public.role_preassignments where lower(email) = lower(new.email);
  insert into public.profiles (id, email, full_name, avatar_url, last_sign_in_at)
  values (new.id, lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', v_pre.full_name),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    new.last_sign_in_at)
  on conflict (id) do nothing;
  if lower(new.email) = v_boot or not exists (select 1 from public.user_roles where role = 'admin') then
    v_role := 'admin';  -- bootstrap admin, or the very first person to sign in
  elsif v_pre.email is not null then
    v_role := v_pre.role;
  end if;
  insert into public.user_roles (user_id, role) values (new.id, v_role) on conflict (user_id) do nothing;
  delete from public.role_preassignments where lower(email) = lower(new.email);
  return new;
end $$;

create or replace function public.handle_user_sign_in() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set
    last_sign_in_at = new.last_sign_in_at,
    full_name = coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', full_name),
    avatar_url = coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', avatar_url)
  where id = new.id;
  return new;
end $$;

create trigger enforce_domain before insert on auth.users
  for each row execute function public.enforce_domain();
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
create trigger on_auth_user_signed_in after update of last_sign_in_at on auth.users
  for each row execute function public.handle_user_sign_in();

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

-- ===== Helpers =====
create or replace function public.log_activity(p_entity_type text, p_entity_id uuid, p_trade_id uuid, p_action text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.activity_log(entity_type, entity_id, trade_id, action, details, actor_id)
  values (p_entity_type, p_entity_id, p_trade_id, p_action, coalesce(p_details,'{}'::jsonb), auth.uid());
$$;
revoke execute on function public.log_activity(text, uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.add_attachment(p_entity_type text, p_entity_id uuid, p_doc_type text, p_file jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_file is null or coalesce(p_file->>'path','') = '' then
    raise exception '% file is required', p_doc_type;
  end if;
  insert into public.attachments(entity_type, entity_id, doc_type, file_path, file_name, file_size, uploaded_by)
  values (p_entity_type, p_entity_id, p_doc_type, p_file->>'path', coalesce(p_file->>'name','file'), nullif(p_file->>'size','')::bigint, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.add_attachment(text, uuid, text, jsonb) from public, anon, authenticated;

-- ===== Rule triggers =====
create or replace function public.check_trade_exp_total(p_trade uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_contract numeric; v_code text;
begin
  select contract_amount, code into v_contract, v_code from public.trades where id = p_trade;
  if v_contract is null then return; end if;
  select coalesce(sum(amount),0) into v_total from public.exps where trade_id = p_trade;
  if v_total > v_contract then
    raise exception 'EXP total % exceeds the contract amount % for %', public.fmt_bdt(v_total), public.fmt_bdt(v_contract), v_code;
  end if;
end $$;

create or replace function public.trg_exps_total() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.check_trade_exp_total(new.trade_id); return null; end $$;
create or replace function public.trg_trades_total() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.check_trade_exp_total(new.id); return null; end $$;

create constraint trigger exps_total_check after insert or update on public.exps
  deferrable initially deferred for each row execute function public.trg_exps_total();
create constraint trigger trades_total_check after update of contract_amount on public.trades
  deferrable initially deferred for each row execute function public.trg_trades_total();

create or replace function public.trg_exp_lock() returns trigger language plpgsql as $$
begin
  if old.status = 'closed' and new.amount is distinct from old.amount then
    raise exception 'EXP % is closed, its amount is locked', old.code;
  end if;
  return new;
end $$;
create trigger exp_lock before update on public.exps for each row execute function public.trg_exp_lock();

create or replace function public.trg_exp_create_docs() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.exp_documents(exp_id, doc_type, sort_order, is_demo)
  select new.id, d.name, d.ord, new.is_demo from unnest(array['Airway Bill','Bill of Export','Phytosanitary Certificate','Asycuda VAT Certificate','Commercial Invoice and Packing List','EXP Form']) with ordinality as d(name, ord);
  return new;
end $$;
create trigger exp_create_docs after insert on public.exps for each row execute function public.trg_exp_create_docs();

create or replace function public.trg_exp_autoclose() returns trigger language plpgsql security definer set search_path = public as $$
declare v_exp public.exps;
begin
  if (select count(*) from public.exp_documents where exp_id = new.exp_id and status = 'final') = 6 then
    update public.exps set status = 'closed', closed_at = now() where id = new.exp_id and status = 'open' returning * into v_exp;
    if v_exp.id is not null then
      perform public.log_activity('exp', v_exp.id, v_exp.trade_id, 'exp_closed', jsonb_build_object('code', v_exp.code));
    end if;
  end if;
  return null;
end $$;
create trigger exp_autoclose after update of status on public.exp_documents for each row execute function public.trg_exp_autoclose();

-- ===== Views =====
create view public.trade_overview with (security_invoker = true) as
select t.*,
  coalesce((select sum(e.amount) from public.exps e where e.trade_id = t.id), 0)::numeric(16,2) as exp_issued,
  (select sum(e.amount_usd) from public.exps e where e.trade_id = t.id)::numeric(14,2) as exp_issued_usd,
  coalesce((select sum(c.amount) from public.collections c where c.trade_id = t.id and c.status = 'approved'), 0)::numeric(16,2) as collected,
  (select sum(c.amount_usd) from public.collections c where c.trade_id = t.id and c.status = 'approved')::numeric(14,2) as collected_usd,
  (select count(*) from public.exps e where e.trade_id = t.id)::int as exp_count,
  (select a.id from public.trade_amendments a where a.trade_id = t.id and a.status = 'pending_approval' limit 1) as pending_revision_id,
  (select max(a.amendment_no) from public.trade_amendments a where a.trade_id = t.id and a.status = 'approved') as latest_amendment_no
from public.trades t;
grant select on public.trade_overview to authenticated;

create view public.exp_overview with (security_invoker = true) as
select e.*, t.code as trade_code, t.importer_name, t.status as trade_status,
  (select c.status from public.collection_exps ce join public.collections c on c.id = ce.collection_id
    where ce.exp_id = e.id and c.status in ('pending_approval','approved') order by c.created_at desc limit 1) as collection_status,
  (select c.code from public.collection_exps ce join public.collections c on c.id = ce.collection_id
    where ce.exp_id = e.id and c.status in ('pending_approval','approved') order by c.created_at desc limit 1) as collection_code,
  (select i.status from public.incentive_exps ie join public.incentives i on i.id = ie.incentive_id
    where ie.exp_id = e.id and i.status in ('pending_approval','approved') order by i.created_at desc limit 1) as incentive_status,
  (select count(*) from public.exp_documents d where d.exp_id = e.id and d.status = 'final')::int as docs_final,
  (select count(*) from public.exp_documents d where d.exp_id = e.id and d.status <> 'missing')::int as docs_uploaded
from public.exps e join public.trades t on t.id = e.trade_id;
grant select on public.exp_overview to authenticated;

-- ===== Items =====
create or replace function public.normalize_items(p_items jsonb) returns jsonb
language plpgsql immutable as $$
declare r jsonb; out jsonb := '[]'::jsonb; q numeric; rt numeric; ru numeric; i int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item line';
  end if;
  for r in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    if coalesce(trim(r->>'description'),'') = '' then raise exception 'Item % needs a description', i; end if;
    q := nullif(r->>'quantity_kg','')::numeric; rt := nullif(r->>'rate_per_kg','')::numeric; ru := nullif(r->>'rate_usd_per_kg','')::numeric;
    if q is null or q <= 0 then raise exception 'Item % needs a quantity above 0', i; end if;
    if rt is null or rt <= 0 then raise exception 'Item % needs a BDT rate above 0', i; end if;
    out := out || jsonb_build_object('description', trim(r->>'description'), 'carton_size', nullif(trim(r->>'carton_size'),''),
      'hs_code', nullif(trim(r->>'hs_code'),''), 'incoterm', nullif(trim(r->>'incoterm'),''),
      'quantity_kg', round(q,3), 'rate_per_kg', round(rt,4), 'rate_usd_per_kg', case when ru > 0 then round(ru,4) end, 'line_total', round(q*rt,2));
  end loop;
  return out;
end $$;

create or replace function public.replace_trade_items(p_trade uuid, p_items jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_total numeric;
begin
  delete from public.trade_items where trade_id = p_trade;
  insert into public.trade_items(trade_id, sort_order, description, carton_size, hs_code, incoterm, quantity_kg, rate_per_kg, rate_usd_per_kg, line_total)
  select p_trade, ord, x->>'description', x->>'carton_size', x->>'hs_code', x->>'incoterm',
    (x->>'quantity_kg')::numeric, (x->>'rate_per_kg')::numeric, nullif(x->>'rate_usd_per_kg','')::numeric, (x->>'line_total')::numeric
  from jsonb_array_elements(p_items) with ordinality as a(x, ord);
  select coalesce(sum(line_total),0) into v_total from public.trade_items where trade_id = p_trade;
  update public.trades set products = coalesce((select string_agg(description, ', ' order by sort_order) from public.trade_items where trade_id = p_trade), '')
  where id = p_trade;
  return v_total;
end $$;
revoke execute on function public.replace_trade_items(uuid, jsonb) from public, anon, authenticated;

-- ===== Trade RPCs =====
create or replace function public.create_trade(p_data jsonb, p_items jsonb, p_file jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_items jsonb; v_amount numeric; k text; v_code text;
begin
  perform public.require_member();
  foreach k in array array['exporter','importer_name','importer_country','sales_contract_no','contract_date'] loop
    if coalesce(trim(p_data->>k),'') = '' then raise exception 'Missing required field: %', replace(replace(k,'importer','buyer'),'_',' '); end if;
  end loop;
  if exists (select 1 from public.trades where lower(sales_contract_no) = lower(trim(p_data->>'sales_contract_no'))) then
    raise exception 'SC number % already exists', trim(p_data->>'sales_contract_no');
  end if;
  if p_file is null or coalesce(p_file->>'path','') = '' then raise exception 'Sales contract file is required'; end if;
  v_items := public.normalize_items(p_items);
  select sum((x->>'line_total')::numeric) into v_amount from jsonb_array_elements(v_items) x;
  insert into public.trades(
    exporter, exporter_address, exporter_phone, exporter_email,
    importer_name, buyer_cr_no, buyer_vat_no, buyer_address, importer_country,
    notify_parties, products,
    sales_contract_no, contract_date, shipping_mark, country_of_origin, country_of_destination, expiry_date, shipment_timeline,
    carriage_by, departure_port, point_of_entry, payment_type, payment_terms, tolerance_pct,
    bank_name, bank_branch, bank_routing_no, bank_swift, bank_account_name, bank_account_no,
    incentive_terms, notes, contract_amount, contract_amount_usd, exchange_rate, currency, contract_extra, created_by)
  values (
    trim(p_data->>'exporter'), nullif(trim(p_data->>'exporter_address'),''), nullif(trim(p_data->>'exporter_phone'),''), nullif(trim(p_data->>'exporter_email'),''),
    trim(p_data->>'importer_name'), nullif(trim(p_data->>'buyer_cr_no'),''), nullif(trim(p_data->>'buyer_vat_no'),''), nullif(trim(p_data->>'buyer_address'),''), trim(p_data->>'importer_country'),
    coalesce(p_data->'notify_parties','[]'::jsonb), '',
    trim(p_data->>'sales_contract_no'), (p_data->>'contract_date')::date, nullif(trim(p_data->>'shipping_mark'),''),
    nullif(trim(p_data->>'country_of_origin'),''), nullif(trim(p_data->>'country_of_destination'),''),
    nullif(p_data->>'expiry_date','')::date, nullif(trim(p_data->>'shipment_timeline'),''),
    nullif(p_data->>'carriage_by',''), nullif(trim(p_data->>'departure_port'),''), nullif(trim(p_data->>'point_of_entry'),''),
    nullif(p_data->>'payment_type',''), nullif(trim(p_data->>'payment_terms'),''), nullif(p_data->>'tolerance_pct','')::numeric,
    nullif(trim(p_data->>'bank_name'),''), nullif(trim(p_data->>'bank_branch'),''), nullif(trim(p_data->>'bank_routing_no'),''),
    nullif(trim(p_data->>'bank_swift'),''), nullif(trim(p_data->>'bank_account_name'),''), nullif(trim(p_data->>'bank_account_no'),''),
    nullif(trim(p_data->>'incentive_terms'),''), nullif(trim(p_data->>'notes'),''), round(v_amount,2),
    round(nullif(p_data->>'contract_amount_usd','')::numeric, 2), nullif(p_data->>'exchange_rate','')::numeric, 'BDT',
    coalesce(p_data->'contract_extra','{}'::jsonb), auth.uid())
  returning id, code into v_id, v_code;
  perform public.replace_trade_items(v_id, v_items);
  perform public.add_attachment('trade_contract', v_id, 'Sales contract', p_file);
  perform public.log_activity('trade', v_id, v_id, 'trade_created', jsonb_build_object('code', v_code, 'amount', v_amount));
  return v_id;
end $$;

create or replace function public.approve_trade(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  perform public.require_admin();
  update public.trades set status = 'active', approved_by = auth.uid(), approved_at = now(), rejection_reason = null, updated_at = now()
  where id = p_id and status = 'pending_approval' returning code into v_code;
  if v_code is null then raise exception 'This trade is not awaiting approval'; end if;
  perform public.log_activity('trade', p_id, p_id, 'trade_approved', jsonb_build_object('code', v_code));
end $$;

create or replace function public.reject_trade(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  perform public.require_admin();
  if coalesce(trim(p_reason),'') = '' then raise exception 'A rejection reason is required'; end if;
  update public.trades set status = 'rejected', approved_by = auth.uid(), approved_at = now(), rejection_reason = trim(p_reason), updated_at = now()
  where id = p_id and status = 'pending_approval' returning code into v_code;
  if v_code is null then raise exception 'This trade is not awaiting approval'; end if;
  perform public.log_activity('trade', p_id, p_id, 'trade_rejected', jsonb_build_object('code', v_code, 'reason', p_reason));
end $$;

-- Close a fully delivered trade (admin). All EXPs must be closed.
create or replace function public.close_trade(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_t public.trades;
begin
  perform public.require_admin();
  select * into v_t from public.trades where id = p_id for update;
  if v_t.id is null then raise exception 'Trade not found'; end if;
  if v_t.status <> 'active' then raise exception 'Only active trades can be closed'; end if;
  if exists (select 1 from public.exps where trade_id = p_id and status = 'open') then
    raise exception 'Close all EXPs (all six documents final) before closing the trade';
  end if;
  update public.trades set status = 'closed', updated_at = now() where id = p_id;
  perform public.log_activity('trade', p_id, p_id, 'trade_closed', jsonb_build_object('code', v_t.code));
end $$;

-- ===== EXP RPCs =====
create or replace function public.create_exp(p_trade uuid, p_amount numeric, p_advance boolean, p_fields jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_t public.trades; v_total numeric; v_id uuid; v_code text; v_ship text := nullif(trim(p_fields->>'shipment_id'),'');
begin
  perform public.require_member();
  select * into v_t from public.trades where id = p_trade;
  if v_t.id is null then raise exception 'Trade not found'; end if;
  if v_t.status <> 'active' then raise exception 'EXPs can only be added to active trades'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'EXP amount must be greater than 0'; end if;
  if not coalesce(p_advance,false) and v_ship is null then raise exception 'Shipment ID is required for regular EXPs'; end if;
  select coalesce(sum(amount),0) into v_total from public.exps where trade_id = p_trade;
  if v_total + p_amount > v_t.contract_amount then
    raise exception 'EXP total % exceeds the contract amount %. Available: %', public.fmt_bdt(v_total + p_amount), public.fmt_bdt(v_t.contract_amount), public.fmt_bdt(v_t.contract_amount - v_total);
  end if;
  insert into public.exps(trade_id, shipment_id, exp_no, awb_no, flight_no, shipment_date, amount, amount_usd, type, created_by)
  values (p_trade, v_ship, nullif(trim(p_fields->>'exp_no'),''), nullif(trim(p_fields->>'awb_no'),''), nullif(trim(p_fields->>'flight_no'),''),
    nullif(p_fields->>'shipment_date','')::date, round(p_amount,2), round(nullif(p_fields->>'amount_usd','')::numeric,2),
    case when p_advance then 'advance'::public.exp_type else 'regular'::public.exp_type end, auth.uid())
  returning id, code into v_id, v_code;
  perform public.log_activity('exp', v_id, p_trade, 'exp_created', jsonb_build_object('code', v_code, 'amount', p_amount, 'advance', coalesce(p_advance,false)));
  return v_id;
end $$;

create or replace function public.update_exp(p_id uuid, p_amount numeric, p_fields jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_e public.exps; v_status public.trade_status; v_ship text := nullif(trim(p_fields->>'shipment_id'),'');
begin
  perform public.require_member();
  select * into v_e from public.exps where id = p_id;
  if v_e.id is null then raise exception 'EXP not found'; end if;
  select status into v_status from public.trades where id = v_e.trade_id;
  if p_amount is not null and p_amount <> v_e.amount then
    if v_e.status = 'closed' then raise exception 'EXP % is closed, its amount is locked', v_e.code; end if;
    if v_status <> 'active' then raise exception 'EXP amounts can only change on active trades'; end if;
    if p_amount <= 0 then raise exception 'EXP amount must be greater than 0'; end if;
  end if;
  if v_e.type = 'regular' and v_ship is null then raise exception 'Shipment ID is required for regular EXPs'; end if;
  update public.exps set amount = coalesce(round(p_amount,2), amount), shipment_id = v_ship,
    amount_usd = case when p_fields ? 'amount_usd' then round(nullif(p_fields->>'amount_usd','')::numeric,2) else amount_usd end,
    exp_no = nullif(trim(p_fields->>'exp_no'),''), awb_no = nullif(trim(p_fields->>'awb_no'),''),
    flight_no = nullif(trim(p_fields->>'flight_no'),''), shipment_date = nullif(p_fields->>'shipment_date','')::date
  where id = p_id;
  perform public.log_activity('exp', p_id, v_e.trade_id, 'exp_updated',
    jsonb_build_object('code', v_e.code, 'old_amount', v_e.amount, 'amount', coalesce(p_amount, v_e.amount)));
end $$;

create or replace function public.upload_exp_document(p_doc uuid, p_file jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_d public.exp_documents; v_e public.exps;
begin
  perform public.require_member();
  select * into v_d from public.exp_documents where id = p_doc;
  if v_d.id is null then raise exception 'Document not found'; end if;
  select * into v_e from public.exps where id = v_d.exp_id;
  if v_d.status = 'final' then raise exception '% is already final', v_d.doc_type; end if;
  if v_e.shipment_id is null then raise exception 'Add the shipment ID to this EXP before uploading documents'; end if;
  if p_file is null or coalesce(p_file->>'path','') = '' then raise exception 'File is required'; end if;
  update public.exp_documents set status = 'uploaded', file_path = p_file->>'path', file_name = p_file->>'name',
    file_size = nullif(p_file->>'size','')::bigint, uploaded_by = auth.uid(), uploaded_at = now() where id = p_doc;
  perform public.log_activity('exp_document', p_doc, v_e.trade_id, 'document_uploaded', jsonb_build_object('code', v_e.code, 'doc', v_d.doc_type));
end $$;

create or replace function public.finalize_exp_document(p_doc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_d public.exp_documents; v_e public.exps;
begin
  perform public.require_member();
  select * into v_d from public.exp_documents where id = p_doc;
  if v_d.id is null then raise exception 'Document not found'; end if;
  if v_d.status <> 'uploaded' then raise exception 'Upload % before marking it final', v_d.doc_type; end if;
  select * into v_e from public.exps where id = v_d.exp_id;
  update public.exp_documents set status = 'final', finalized_by = auth.uid(), finalized_at = now() where id = p_doc;
  perform public.log_activity('exp_document', p_doc, v_e.trade_id, 'document_final', jsonb_build_object('code', v_e.code, 'doc', v_d.doc_type));
end $$;

-- ===== Amendments =====
create or replace function public.request_amendment(p_trade uuid, p_data jsonb, p_items jsonb, p_file jsonb, p_changes jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_t public.trades; v_snapshot jsonb := '[]'::jsonb; v_total numeric := 0; r record; v_new numeric; v_id uuid;
  v_items jsonb; v_old_items jsonb; v_amount numeric; v_no int;
begin
  perform public.require_member();
  select * into v_t from public.trades where id = p_trade for update;
  if v_t.id is null then raise exception 'Trade not found'; end if;
  if v_t.status <> 'active' then raise exception 'Only active trades without a pending amendment can be amended'; end if;
  if coalesce(trim(p_data->>'reason'),'') = '' then raise exception 'A reason is required'; end if;
  if coalesce(p_data->>'amendment_date','') = '' then raise exception 'Amendment date is required'; end if;
  v_no := nullif(p_data->>'amendment_no','')::int;
  if v_no is null or v_no <= 0 then raise exception 'Amendment number is required'; end if;
  if exists (select 1 from public.trade_amendments where trade_id = p_trade and amendment_no = v_no and status not in ('rejected','withdrawn')) then
    raise exception 'Amendment number % already exists on this trade', v_no;
  end if;
  if p_file is null or coalesce(p_file->>'path','') = '' then raise exception 'Amendment copy is required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('description', description, 'carton_size', carton_size, 'hs_code', hs_code, 'incoterm', incoterm,
    'quantity_kg', quantity_kg, 'rate_per_kg', rate_per_kg, 'rate_usd_per_kg', rate_usd_per_kg, 'line_total', line_total) order by sort_order), '[]'::jsonb)
    into v_old_items from public.trade_items where trade_id = p_trade;
  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    v_items := public.normalize_items(p_items);
    select sum((x->>'line_total')::numeric) into v_amount from jsonb_array_elements(v_items) x;
  else
    v_amount := nullif(p_data->>'new_amount','')::numeric;
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'New contract amount must be greater than 0'; end if;
  v_amount := round(v_amount, 2);
  for r in select * from public.exps where trade_id = p_trade order by created_at loop
    v_new := null;
    select (c->>'amount')::numeric into v_new from jsonb_array_elements(coalesce(p_changes,'[]'::jsonb)) c where (c->>'exp_id')::uuid = r.id limit 1;
    v_new := round(coalesce(v_new, r.amount), 2);
    if v_new <= 0 then raise exception 'EXP % amount must be greater than 0', r.code; end if;
    if r.status = 'closed' and v_new <> r.amount then raise exception 'EXP % is closed, its amount is locked', r.code; end if;
    v_total := v_total + v_new;
    v_snapshot := v_snapshot || jsonb_build_object('exp_id', r.id, 'code', r.code, 'status', r.status, 'old_amount', r.amount, 'new_amount', v_new);
  end loop;
  if v_total > v_amount then
    raise exception 'EXP total % exceeds the new contract amount %', public.fmt_bdt(v_total), public.fmt_bdt(v_amount);
  end if;
  insert into public.trade_amendments(trade_id, amendment_no, amendment_date, reason, old_amount, new_amount, old_items, new_items,
    old_expiry_date, new_expiry_date, old_shipment_timeline, new_shipment_timeline, exp_changes, requested_by)
  values (p_trade, v_no, (p_data->>'amendment_date')::date, trim(p_data->>'reason'), v_t.contract_amount, v_amount, v_old_items, v_items,
    v_t.expiry_date, nullif(p_data->>'new_expiry_date','')::date, v_t.shipment_timeline, nullif(trim(p_data->>'new_shipment_timeline'),''),
    v_snapshot, auth.uid())
  returning id into v_id;
  perform public.add_attachment('trade_amendment', v_id, 'Amendment copy', p_file);
  update public.trades set status = 'revision_pending', updated_at = now() where id = p_trade;
  perform public.log_activity('revision', v_id, p_trade, 'revision_requested',
    jsonb_build_object('code', v_t.code, 'amendment_no', v_no, 'old_amount', v_t.contract_amount, 'new_amount', v_amount, 'reason', p_data->>'reason'));
  return v_id;
end $$;

create or replace function public.approve_amendment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_a public.trade_amendments; c jsonb; v_e public.exps;
begin
  perform public.require_admin();
  select * into v_a from public.trade_amendments where id = p_id for update;
  if v_a.id is null or v_a.status <> 'pending_approval' then raise exception 'This amendment is not awaiting approval'; end if;
  for c in select * from jsonb_array_elements(v_a.exp_changes) loop
    if (c->>'new_amount')::numeric <> (c->>'old_amount')::numeric then
      select * into v_e from public.exps where id = (c->>'exp_id')::uuid;
      if v_e.id is not null then
        if v_e.status = 'closed' then raise exception 'EXP % closed after the request, amendment cannot be applied', v_e.code; end if;
        update public.exps set amount = (c->>'new_amount')::numeric where id = v_e.id;
      end if;
    end if;
  end loop;
  if v_a.new_items is not null then perform public.replace_trade_items(v_a.trade_id, v_a.new_items); end if;
  update public.trades set contract_amount = v_a.new_amount, status = 'active', updated_at = now(),
    expiry_date = coalesce(v_a.new_expiry_date, expiry_date),
    shipment_timeline = coalesce(v_a.new_shipment_timeline, shipment_timeline)
  where id = v_a.trade_id;
  update public.trade_amendments set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform public.check_trade_exp_total(v_a.trade_id);
  perform public.log_activity('revision', p_id, v_a.trade_id, 'revision_approved',
    jsonb_build_object('amendment_no', v_a.amendment_no, 'old_amount', v_a.old_amount, 'new_amount', v_a.new_amount));
end $$;

create or replace function public.reject_amendment(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_a public.trade_amendments;
begin
  perform public.require_admin();
  if coalesce(trim(p_reason),'') = '' then raise exception 'A rejection reason is required'; end if;
  select * into v_a from public.trade_amendments where id = p_id for update;
  if v_a.id is null or v_a.status <> 'pending_approval' then raise exception 'This amendment is not awaiting approval'; end if;
  update public.trade_amendments set status = 'rejected', approved_by = auth.uid(), approved_at = now(), rejection_reason = trim(p_reason) where id = p_id;
  update public.trades set status = 'active', updated_at = now() where id = v_a.trade_id and status = 'revision_pending';
  perform public.log_activity('revision', p_id, v_a.trade_id, 'revision_rejected',
    jsonb_build_object('amendment_no', v_a.amendment_no, 'reason', p_reason, 'new_amount', v_a.new_amount));
end $$;

-- Submitter (or an admin) can withdraw a pending amendment
create or replace function public.withdraw_amendment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_a public.trade_amendments;
begin
  perform public.require_member();
  select * into v_a from public.trade_amendments where id = p_id for update;
  if v_a.id is null or v_a.status <> 'pending_approval' then raise exception 'This amendment is not pending'; end if;
  if v_a.requested_by <> auth.uid() and not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only the person who requested it can withdraw this amendment';
  end if;
  update public.trade_amendments set status = 'withdrawn' where id = p_id;
  update public.trades set status = 'active', updated_at = now() where id = v_a.trade_id and status = 'revision_pending';
  perform public.log_activity('revision', p_id, v_a.trade_id, 'revision_withdrawn', jsonb_build_object('amendment_no', v_a.amendment_no));
end $$;

-- ===== Collection RPCs =====
create or replace function public.create_collection(p_trade uuid, p_amount numeric, p_bank_ref text, p_exp_ids uuid[], p_docs jsonb, p_amount_usd numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_t public.trades; v_sum numeric; v_cnt int; v_id uuid; v_code text; d text; v_file jsonb;
begin
  perform public.require_member();
  select * into v_t from public.trades where id = p_trade;
  if v_t.id is null then raise exception 'Trade not found'; end if;
  if v_t.status not in ('active','revision_pending') then raise exception 'Collections can only be made on active trades'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount received must be greater than 0'; end if;
  if p_exp_ids is null or array_length(p_exp_ids,1) is null then raise exception 'Select at least one EXP'; end if;
  select count(*), coalesce(sum(amount),0) into v_cnt, v_sum from public.exps where id = any(p_exp_ids) and trade_id = p_trade;
  if v_cnt <> array_length(p_exp_ids,1) then raise exception 'All selected EXPs must belong to %', v_t.code; end if;
  if exists (select 1 from public.collection_exps ce join public.collections c on c.id = ce.collection_id
             where ce.exp_id = any(p_exp_ids) and c.status in ('pending_approval','approved')) then
    raise exception 'One or more selected EXPs are already in a pending or approved collection';
  end if;
  if v_sum <> round(p_amount,2) then
    raise exception 'Selected EXPs total % must equal the amount received %', public.fmt_bdt(v_sum), public.fmt_bdt(p_amount);
  end if;
  foreach d in array array['PRC','Ka Form','Swift Copy','TT Voucher'] loop
    select x into v_file from jsonb_array_elements(coalesce(p_docs,'[]'::jsonb)) x where x->>'doc_type' = d limit 1;
    if v_file is null or coalesce(v_file->>'path','') = '' then raise exception '% is required', d; end if;
  end loop;
  insert into public.collections(trade_id, amount, amount_usd, bank_reference, created_by)
  values (p_trade, round(p_amount,2), round(p_amount_usd,2), nullif(trim(p_bank_ref),''), auth.uid()) returning id, code into v_id, v_code;
  insert into public.collection_exps(collection_id, exp_id, amount) select v_id, id, amount from public.exps where id = any(p_exp_ids);
  foreach d in array array['PRC','Ka Form','Swift Copy','TT Voucher'] loop
    select x into v_file from jsonb_array_elements(p_docs) x where x->>'doc_type' = d limit 1;
    perform public.add_attachment('collection', v_id, d, v_file);
  end loop;
  perform public.log_activity('collection', v_id, p_trade, 'collection_created', jsonb_build_object('code', v_code, 'amount', p_amount));
  return v_id;
end $$;

create or replace function public.decide_collection(p_id uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_c public.collections;
begin
  perform public.require_admin();
  if not p_approve and coalesce(trim(p_reason),'') = '' then raise exception 'A rejection reason is required'; end if;
  update public.collections set status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end,
    approved_by = auth.uid(), approved_at = now(), rejection_reason = case when p_approve then null else trim(p_reason) end
  where id = p_id and status = 'pending_approval' returning * into v_c;
  if v_c.id is null then raise exception 'This collection is not awaiting approval'; end if;
  perform public.log_activity('collection', p_id, v_c.trade_id, case when p_approve then 'collection_approved' else 'collection_rejected' end,
    jsonb_build_object('code', v_c.code, 'amount', v_c.amount, 'reason', p_reason));
end $$;

-- ===== Incentive RPCs =====
create or replace function public.create_incentive(p_exp_ids uuid[], p_net numeric, p_freight numeric, p_pct numeric, p_docs jsonb, p_net_usd numeric default null, p_freight_usd numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_cnt int; v_sum numeric; v_fob numeric; v_inc numeric; v_id uuid; v_code text; d text; v_file jsonb; v_trade uuid;
  v_types text[] := array['Freight Certificate','Forwarding Letter','PRC','TT Calculation Copy','Swift Copy','Ka Form','Association Certificate','Undertakings'];
begin
  perform public.require_member();
  if p_exp_ids is null or array_length(p_exp_ids,1) is null then raise exception 'Select at least one collected EXP'; end if;
  select count(*), coalesce(sum(e.amount),0) into v_cnt, v_sum from public.exps e
  where e.id = any(p_exp_ids) and exists (select 1 from public.collection_exps ce join public.collections c on c.id = ce.collection_id
    where ce.exp_id = e.id and c.status = 'approved');
  if v_cnt <> array_length(p_exp_ids,1) then raise exception 'Only EXPs from approved collections can be used'; end if;
  if exists (select 1 from public.incentive_exps ie join public.incentives i on i.id = ie.incentive_id
             where ie.exp_id = any(p_exp_ids) and i.status in ('pending_approval','approved')) then
    raise exception 'One or more selected EXPs are already in an incentive claim';
  end if;
  if p_net is null or p_net <= 0 then raise exception 'Net proceed must be greater than 0'; end if;
  if p_net > v_sum then raise exception 'Net proceed % cannot be above the EXP amount %', public.fmt_bdt(p_net), public.fmt_bdt(v_sum); end if;
  if p_freight is null or p_freight < 0 then raise exception 'Freight cannot be negative'; end if;
  if p_freight >= p_net then raise exception 'Freight must be less than net proceed'; end if;
  if p_pct is null or p_pct <= 0 or p_pct > 100 then raise exception 'Incentive percent must be between 0 and 100'; end if;
  v_fob := round(p_net - p_freight, 2);
  v_inc := round(v_fob * p_pct / 100, 2);
  foreach d in array v_types loop
    select x into v_file from jsonb_array_elements(coalesce(p_docs,'[]'::jsonb)) x where x->>'doc_type' = d limit 1;
    if v_file is null or coalesce(v_file->>'path','') = '' then raise exception '% is required', d; end if;
  end loop;
  insert into public.incentives(exp_amount, net_proceed, freight, fob, incentive_pct, incentive_amount, net_proceed_usd, freight_usd, created_by)
  values (v_sum, round(p_net,2), round(p_freight,2), v_fob, p_pct, v_inc, round(p_net_usd,2), round(p_freight_usd,2), auth.uid()) returning id, code into v_id, v_code;
  insert into public.incentive_exps(incentive_id, exp_id, amount) select v_id, id, amount from public.exps where id = any(p_exp_ids);
  foreach d in array v_types loop
    select x into v_file from jsonb_array_elements(p_docs) x where x->>'doc_type' = d limit 1;
    perform public.add_attachment('incentive', v_id, d, v_file);
  end loop;
  for v_trade in select distinct trade_id from public.exps where id = any(p_exp_ids) loop
    perform public.log_activity('incentive', v_id, v_trade, 'incentive_created', jsonb_build_object('code', v_code, 'amount', v_inc));
  end loop;
  return v_id;
end $$;

create or replace function public.decide_incentive(p_id uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_i public.incentives; v_trade uuid;
begin
  perform public.require_admin();
  if not p_approve and coalesce(trim(p_reason),'') = '' then raise exception 'A rejection reason is required'; end if;
  update public.incentives set status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end,
    approved_by = auth.uid(), approved_at = now(), rejection_reason = case when p_approve then null else trim(p_reason) end
  where id = p_id and status = 'pending_approval' returning * into v_i;
  if v_i.id is null then raise exception 'This incentive is not awaiting approval'; end if;
  for v_trade in select distinct e.trade_id from public.incentive_exps ie join public.exps e on e.id = ie.exp_id where ie.incentive_id = p_id loop
    perform public.log_activity('incentive', p_id, v_trade, case when p_approve then 'incentive_approved' else 'incentive_rejected' end,
      jsonb_build_object('code', v_i.code, 'amount', v_i.incentive_amount, 'reason', p_reason));
  end loop;
end $$;

-- ===== Counts =====
create or replace function public.pending_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_member();
  return jsonb_build_object(
    'trades', (select count(*) from public.trades where status in ('pending_approval','revision_pending')),
    'collections', (select count(*) from public.collections where status = 'pending_approval'),
    'incentives', (select count(*) from public.incentives where status = 'pending_approval'));
end $$;

-- ===== Access control RPCs =====
create or replace function public.admin_count() returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.user_roles where role = 'admin'
$$;

create or replace function public.set_user_role(p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = public as $$
declare v_old public.app_role;
begin
  perform public.require_admin();
  select role into v_old from public.user_roles where user_id = p_user;
  if v_old = 'admin' and p_role <> 'admin' and public.admin_count() <= 1 then
    raise exception 'There must be at least one admin';
  end if;
  insert into public.user_roles(user_id, role) values (p_user, p_role)
  on conflict (user_id) do update set role = excluded.role;
  perform public.log_activity('user', p_user, null, 'role_changed', jsonb_build_object('from', v_old, 'to', p_role));
end $$;

create or replace function public.remove_access(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_old public.app_role;
begin
  perform public.require_admin();
  select role into v_old from public.user_roles where user_id = p_user;
  if v_old = 'admin' and public.admin_count() <= 1 then raise exception 'You cannot remove the last admin'; end if;
  delete from public.user_roles where user_id = p_user;
  perform public.log_activity('user', p_user, null, 'access_removed', jsonb_build_object('role', v_old));
end $$;

create or replace function public.preassign_role(p_email text, p_name text, p_role public.app_role) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); v_uid uuid;
begin
  perform public.require_admin();
  if v_email !~ ('^[^@\s]+@' || replace(public.allowed_domain(), '.', '\.') || '$') then
    raise exception 'Email must be a % address', public.allowed_domain();
  end if;
  select id into v_uid from public.profiles where email = v_email;
  if v_uid is not null then
    perform public.set_user_role(v_uid, p_role);
    return;
  end if;
  insert into public.role_preassignments(email, full_name, role, created_by) values (v_email, nullif(trim(p_name),''), p_role, auth.uid())
  on conflict (email) do update set full_name = excluded.full_name, role = excluded.role;
end $$;

create or replace function public.delete_preassignment(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  delete from public.role_preassignments where email = lower(trim(p_email));
end $$;

-- ===== Demo data helpers =====
create or replace function public.demo_count() returns int
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_member();
  return (select count(*) from public.trades where is_demo) + (select count(*) from public.exps where is_demo)
    + (select count(*) from public.collections where is_demo) + (select count(*) from public.incentives where is_demo)
    + (select count(*) from public.trade_amendments where is_demo);
end $$;

create or replace function public.remove_demo_data() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform public.require_admin();
  v_n := public.demo_count();
  delete from public.incentive_exps where incentive_id in (select id from public.incentives where is_demo)
    or exp_id in (select id from public.exps where is_demo);
  delete from public.incentives where is_demo;
  delete from public.collection_exps where collection_id in (select id from public.collections where is_demo)
    or exp_id in (select id from public.exps where is_demo);
  delete from public.collections where is_demo;
  delete from public.exp_documents where is_demo or exp_id in (select id from public.exps where is_demo);
  delete from public.exps where is_demo;
  delete from public.trade_amendments where is_demo;
  delete from public.trade_items where is_demo or trade_id in (select id from public.trades where is_demo);
  delete from public.attachments where is_demo;
  delete from public.activity_log where is_demo or trade_id in (select id from public.trades where is_demo);
  delete from public.trades where is_demo;
  return v_n;
end $$;

-- ===== Lock down RPC execution to signed-in users =====
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'create_trade','approve_trade','reject_trade','close_trade','create_exp','update_exp','upload_exp_document','finalize_exp_document',
             'request_amendment','approve_amendment','reject_amendment','withdraw_amendment','create_collection','decide_collection',
             'create_incentive','decide_incentive','pending_counts','set_user_role','remove_access','preassign_role','delete_preassignment',
             'demo_count','remove_demo_data') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- ===== Storage: private documents bucket =====
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)
on conflict (id) do nothing;

create policy "Members read documents" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_member(auth.uid()));
create policy "Members upload documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_member(auth.uid()));
create policy "Admins delete documents" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.has_role(auth.uid(), 'admin'));
