-- Masters (company profiles, buyers, products), sales contract versions, EXP follow-ups.

-- ===== Company profiles (exporter details used on generated sales contracts) =====
create table public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  legal_name text not null,
  address text, phone text, email text,
  signatory_name text, signatory_designation text,
  bank_name text, bank_branch text, bank_routing_no text, bank_swift text, bank_account_name text, bank_account_no text,
  shipping_mark text, sc_prefix text,
  default_terms jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index company_profiles_one_default on public.company_profiles ((true)) where is_default;

-- ===== Buyers =====
create table public.buyers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cr_no text, vat_no text, address text, country text,
  notify_parties jsonb not null default '[]'::jsonb,
  point_of_entry text,
  is_active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index buyers_name_unique on public.buyers (lower(name));

-- ===== Products =====
create table public.products (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  carton_size text, hs_code text, incoterm text default 'CFR',
  rate_usd_per_kg numeric(14,4),
  is_active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index products_desc_unique on public.products (lower(description));

-- ===== Sales contract versions =====
create table public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trades(id) on delete cascade,
  version int not null,
  source text not null check (source in ('generated','uploaded')),
  status text not null default 'draft' check (status in ('draft','signed')),
  file_path text not null, file_name text not null, file_size bigint,
  note text,
  uploaded_by uuid, created_at timestamptz not null default now(),
  signed_by uuid, signed_at timestamptz,
  is_demo boolean not null default false,
  unique (trade_id, version)
);
create index contract_documents_trade on public.contract_documents(trade_id);

-- ===== Follow-ups (checkpoints at 25/50/75/100% of the shipment period) =====
create table public.trade_followups (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trades(id) on delete cascade,
  checkpoint int not null check (checkpoint between 1 and 4),
  note text,
  done_by uuid, done_at timestamptz not null default now(),
  unique (trade_id, checkpoint)
);

-- ===== Trade links =====
alter table public.trades
  add column company_profile_id uuid references public.company_profiles(id),
  add column buyer_id uuid references public.buyers(id),
  add column shipment_deadline date;

-- Shipment deadline from the old free-text timeline when it is a dd/mm/yyyy date
update public.trades set shipment_deadline = to_date(substring(shipment_timeline from '(\d{1,2}/\d{1,2}/\d{4})'), 'DD/MM/YYYY')
where shipment_deadline is null and shipment_timeline ~ '\d{1,2}/\d{1,2}/\d{4}';

-- ===== RLS: members read, writes only through RPCs =====
do $$
declare t text;
begin
  foreach t in array array['company_profiles','buyers','products','contract_documents','trade_followups'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy "Members read" on public.%I for select to authenticated using ((select public.is_member((select auth.uid()))))', t);
  end loop;
end $$;

-- ===== RPCs: masters =====
create or replace function public.save_company_profile(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_default boolean := coalesce((p->>'is_default')::boolean, false);
begin
  perform public.require_admin();
  if coalesce(trim(p->>'label'),'') = '' then raise exception 'Profile name is required'; end if;
  if coalesce(trim(p->>'legal_name'),'') = '' then raise exception 'Company legal name is required'; end if;
  if v_default then update public.company_profiles set is_default = false where is_default and id is distinct from v_id; end if;
  if v_id is null then
    insert into public.company_profiles(label, legal_name, address, phone, email, signatory_name, signatory_designation,
      bank_name, bank_branch, bank_routing_no, bank_swift, bank_account_name, bank_account_no, shipping_mark, sc_prefix, default_terms, is_default, is_active, created_by)
    values (trim(p->>'label'), trim(p->>'legal_name'), nullif(trim(p->>'address'),''), nullif(trim(p->>'phone'),''), nullif(trim(p->>'email'),''),
      nullif(trim(p->>'signatory_name'),''), nullif(trim(p->>'signatory_designation'),''),
      nullif(trim(p->>'bank_name'),''), nullif(trim(p->>'bank_branch'),''), nullif(trim(p->>'bank_routing_no'),''), nullif(trim(p->>'bank_swift'),''),
      nullif(trim(p->>'bank_account_name'),''), nullif(trim(p->>'bank_account_no'),''), nullif(trim(p->>'shipping_mark'),''), nullif(trim(p->>'sc_prefix'),''),
      coalesce(p->'default_terms','{}'::jsonb), v_default or not exists (select 1 from public.company_profiles where is_default), coalesce((p->>'is_active')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.company_profiles set label = trim(p->>'label'), legal_name = trim(p->>'legal_name'), address = nullif(trim(p->>'address'),''),
      phone = nullif(trim(p->>'phone'),''), email = nullif(trim(p->>'email'),''), signatory_name = nullif(trim(p->>'signatory_name'),''),
      signatory_designation = nullif(trim(p->>'signatory_designation'),''), bank_name = nullif(trim(p->>'bank_name'),''), bank_branch = nullif(trim(p->>'bank_branch'),''),
      bank_routing_no = nullif(trim(p->>'bank_routing_no'),''), bank_swift = nullif(trim(p->>'bank_swift'),''), bank_account_name = nullif(trim(p->>'bank_account_name'),''),
      bank_account_no = nullif(trim(p->>'bank_account_no'),''), shipping_mark = nullif(trim(p->>'shipping_mark'),''), sc_prefix = nullif(trim(p->>'sc_prefix'),''),
      default_terms = coalesce(p->'default_terms', default_terms), is_default = v_default,
      is_active = coalesce((p->>'is_active')::boolean, is_active), updated_at = now()
    where id = v_id;
    if not found then raise exception 'Profile not found'; end if;
  end if;
  if not exists (select 1 from public.company_profiles where is_default) then
    update public.company_profiles set is_default = true
    where id = (select id from public.company_profiles where is_active order by created_at limit 1);
  end if;
  return v_id;
end $$;

create or replace function public.save_buyer(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid;
begin
  perform public.require_member();
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'Buyer name is required'; end if;
  if exists (select 1 from public.buyers where lower(name) = lower(trim(p->>'name')) and id is distinct from v_id) then
    raise exception 'A buyer named % already exists', trim(p->>'name');
  end if;
  if v_id is null then
    insert into public.buyers(name, cr_no, vat_no, address, country, notify_parties, point_of_entry, is_active, created_by)
    values (trim(p->>'name'), nullif(trim(p->>'cr_no'),''), nullif(trim(p->>'vat_no'),''), nullif(trim(p->>'address'),''), nullif(trim(p->>'country'),''),
      coalesce(p->'notify_parties','[]'::jsonb), nullif(trim(p->>'point_of_entry'),''), coalesce((p->>'is_active')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.buyers set name = trim(p->>'name'), cr_no = nullif(trim(p->>'cr_no'),''), vat_no = nullif(trim(p->>'vat_no'),''),
      address = nullif(trim(p->>'address'),''), country = nullif(trim(p->>'country'),''), notify_parties = coalesce(p->'notify_parties', notify_parties),
      point_of_entry = nullif(trim(p->>'point_of_entry'),''), is_active = coalesce((p->>'is_active')::boolean, is_active), updated_at = now()
    where id = v_id;
    if not found then raise exception 'Buyer not found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.save_product(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid;
begin
  perform public.require_member();
  if coalesce(trim(p->>'description'),'') = '' then raise exception 'Product description is required'; end if;
  if exists (select 1 from public.products where lower(description) = lower(trim(p->>'description')) and id is distinct from v_id) then
    raise exception 'Product % already exists', trim(p->>'description');
  end if;
  if v_id is null then
    insert into public.products(description, carton_size, hs_code, incoterm, rate_usd_per_kg, is_active, created_by)
    values (trim(p->>'description'), nullif(trim(p->>'carton_size'),''), nullif(trim(p->>'hs_code'),''), coalesce(nullif(trim(p->>'incoterm'),''),'CFR'),
      nullif(p->>'rate_usd_per_kg','')::numeric, coalesce((p->>'is_active')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.products set description = trim(p->>'description'), carton_size = nullif(trim(p->>'carton_size'),''), hs_code = nullif(trim(p->>'hs_code'),''),
      incoterm = coalesce(nullif(trim(p->>'incoterm'),''),'CFR'), rate_usd_per_kg = nullif(p->>'rate_usd_per_kg','')::numeric,
      is_active = coalesce((p->>'is_active')::boolean, is_active), updated_at = now()
    where id = v_id;
    if not found then raise exception 'Product not found'; end if;
  end if;
  return v_id;
end $$;

-- ===== RPCs: contract versions =====
create or replace function public.add_contract_version(p_trade uuid, p_file jsonb, p_source text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_t public.trades; v_ver int; v_id uuid;
begin
  perform public.require_member();
  select * into v_t from public.trades where id = p_trade;
  if v_t.id is null then raise exception 'Trade not found'; end if;
  if p_source not in ('generated','uploaded') then raise exception 'Unknown document source'; end if;
  if p_file is null or coalesce(p_file->>'path','') = '' then raise exception 'File is required'; end if;
  select coalesce(max(version),0) + 1 into v_ver from public.contract_documents where trade_id = p_trade;
  insert into public.contract_documents(trade_id, version, source, file_path, file_name, file_size, note, uploaded_by, is_demo)
  values (p_trade, v_ver, p_source, p_file->>'path', coalesce(p_file->>'name','sales-contract.pdf'), nullif(p_file->>'size','')::bigint,
    nullif(trim(p_note),''), auth.uid(), v_t.is_demo)
  returning id into v_id;
  perform public.log_activity('trade', p_trade, p_trade, case when p_source = 'generated' then 'contract_generated' else 'contract_uploaded' end,
    jsonb_build_object('code', v_t.code, 'version', v_ver));
  return v_id;
end $$;

create or replace function public.mark_contract_signed(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_d public.contract_documents; v_code text;
begin
  perform public.require_member();
  select * into v_d from public.contract_documents where id = p_id for update;
  if v_d.id is null then raise exception 'Document not found'; end if;
  if v_d.source <> 'uploaded' then raise exception 'Upload the signed copy first, then mark that version as signed'; end if;
  if v_d.status = 'signed' then raise exception 'Version % is already marked signed', v_d.version; end if;
  update public.contract_documents set status = 'signed', signed_by = auth.uid(), signed_at = now() where id = p_id;
  select code into v_code from public.trades where id = v_d.trade_id;
  perform public.log_activity('trade', v_d.trade_id, v_d.trade_id, 'contract_signed', jsonb_build_object('code', v_code, 'version', v_d.version));
end $$;

-- ===== RPCs: follow-ups =====
create or replace function public.mark_followup_done(p_trade uuid, p_checkpoint int, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  perform public.require_member();
  select code into v_code from public.trades where id = p_trade;
  if v_code is null then raise exception 'Trade not found'; end if;
  if p_checkpoint not between 1 and 4 then raise exception 'Unknown follow-up'; end if;
  insert into public.trade_followups(trade_id, checkpoint, note, done_by) values (p_trade, p_checkpoint, nullif(trim(p_note),''), auth.uid())
  on conflict (trade_id, checkpoint) do update set note = excluded.note, done_by = excluded.done_by, done_at = now();
  perform public.log_activity('trade', p_trade, p_trade, 'followup_done', jsonb_build_object('code', v_code, 'checkpoint', p_checkpoint));
end $$;

-- ===== create_trade: contract file optional (the console generates one), masters links, shipment deadline =====
create or replace function public.create_trade(p_data jsonb, p_items jsonb, p_file jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_id uuid; v_items jsonb; v_amount numeric; k text; v_code text;
begin
  perform public.require_member();
  foreach k in array array['exporter','importer_name','importer_country','sales_contract_no','contract_date'] loop
    if coalesce(trim(p_data->>k),'') = '' then raise exception 'Missing required field: %', replace(replace(k,'importer','buyer'),'_',' '); end if;
  end loop;
  if exists (select 1 from public.trades where lower(sales_contract_no) = lower(trim(p_data->>'sales_contract_no'))) then
    raise exception 'SC number % already exists', trim(p_data->>'sales_contract_no');
  end if;
  v_items := public.normalize_items(p_items);
  select sum((x->>'line_total')::numeric) into v_amount from jsonb_array_elements(v_items) x;
  insert into public.trades(
    exporter, exporter_address, exporter_phone, exporter_email,
    importer_name, buyer_cr_no, buyer_vat_no, buyer_address, importer_country,
    notify_parties, products,
    sales_contract_no, contract_date, shipping_mark, country_of_origin, country_of_destination, expiry_date, shipment_timeline,
    carriage_by, departure_port, point_of_entry, payment_type, payment_terms, tolerance_pct,
    bank_name, bank_branch, bank_routing_no, bank_swift, bank_account_name, bank_account_no,
    incentive_terms, notes, contract_amount, contract_amount_usd, exchange_rate, currency, contract_extra, created_by,
    company_profile_id, buyer_id, shipment_deadline)
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
    coalesce(p_data->'contract_extra','{}'::jsonb), auth.uid(),
    nullif(p_data->>'company_profile_id','')::uuid, nullif(p_data->>'buyer_id','')::uuid,
    coalesce(nullif(p_data->>'shipment_deadline','')::date,
      case when p_data->>'shipment_timeline' ~ '\d{1,2}/\d{1,2}/\d{4}' then to_date(substring(p_data->>'shipment_timeline' from '(\d{1,2}/\d{1,2}/\d{4})'), 'DD/MM/YYYY') end))
  returning id, code into v_id, v_code;
  perform public.replace_trade_items(v_id, v_items);
  if p_file is not null and coalesce(p_file->>'path','') <> '' then
    insert into public.contract_documents(trade_id, version, source, file_path, file_name, file_size, note, uploaded_by)
    values (v_id, 1, 'uploaded', p_file->>'path', coalesce(p_file->>'name','sales-contract.pdf'), nullif(p_file->>'size','')::bigint, 'Uploaded when the trade was created', auth.uid());
  end if;
  perform public.log_activity('trade', v_id, v_id, 'trade_created', jsonb_build_object('code', v_code, 'amount', v_amount));
  return v_id;
end $function$;

-- ===== create_exp: needs a signed sales contract =====
create or replace function public.create_exp(p_trade uuid, p_amount numeric, p_advance boolean, p_fields jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_t public.trades; v_total numeric; v_id uuid; v_code text; v_ship text := nullif(trim(p_fields->>'shipment_id'),'');
begin
  perform public.require_member();
  select * into v_t from public.trades where id = p_trade;
  if v_t.id is null then raise exception 'Trade not found'; end if;
  if v_t.status <> 'active' then raise exception 'EXPs can only be added to active trades'; end if;
  if not exists (select 1 from public.contract_documents where trade_id = p_trade and status = 'signed') then
    raise exception 'Upload the signed sales contract for % and mark it signed before adding EXPs', v_t.code;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'EXP amount must be greater than 0'; end if;
  if not coalesce(p_advance,false) and v_ship is null then raise exception 'Shipment ID is required for regular EXPs'; end if;
  select coalesce(sum(amount),0) into v_total from public.exps where trade_id = p_trade;
  if v_total + p_amount > v_t.contract_amount then
    raise exception 'EXP total % exceeds the contract amount %. Available: %', public.fmt_bdt(v_total + p_amount), public.fmt_bdt(v_t.contract_amount), public.fmt_bdt(v_t.contract_amount - v_total);
  end if;
  if nullif(trim(p_fields->>'exp_no'),'') is not null and exists (select 1 from public.exps where lower(exp_no) = lower(trim(p_fields->>'exp_no'))) then
    raise exception 'EXP number % already exists', trim(p_fields->>'exp_no');
  end if;
  insert into public.exps(trade_id, shipment_id, exp_no, awb_no, flight_no, shipment_date, amount, amount_usd, type, created_by)
  values (p_trade, v_ship, nullif(trim(p_fields->>'exp_no'),''), nullif(trim(p_fields->>'awb_no'),''), nullif(trim(p_fields->>'flight_no'),''),
    nullif(p_fields->>'shipment_date','')::date, round(p_amount,2), round(nullif(p_fields->>'amount_usd','')::numeric,2),
    case when p_advance then 'advance'::public.exp_type else 'regular'::public.exp_type end, auth.uid())
  returning id, code into v_id, v_code;
  perform public.log_activity('exp', v_id, p_trade, 'exp_created', jsonb_build_object('code', v_code, 'amount', p_amount, 'advance', coalesce(p_advance,false)));
  return v_id;
end $function$;

-- ===== Lock down new RPCs =====
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('save_company_profile','save_buyer','save_product','add_contract_version','mark_contract_signed','mark_followup_done','create_trade','create_exp') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- ===== Existing contract copies become version 1, signed =====
insert into public.contract_documents(trade_id, version, source, status, file_path, file_name, file_size, note, uploaded_by, created_at, signed_by, signed_at, is_demo)
select a.entity_id, 1, 'uploaded', 'signed', a.file_path, a.file_name, a.file_size, 'Contract copy uploaded before versioning', a.uploaded_by, a.created_at, a.uploaded_by, a.created_at, a.is_demo
from public.attachments a
where a.entity_type = 'trade_contract'
  and not exists (select 1 from public.contract_documents c where c.trade_id = a.entity_id);

-- ===== Seed masters from the existing contracts =====
insert into public.company_profiles(label, legal_name, address, phone, email, signatory_name, signatory_designation,
  bank_name, bank_branch, bank_routing_no, bank_swift, bank_account_name, bank_account_no, shipping_mark, sc_prefix, default_terms, is_default)
values ('Unicorn Distribution (Eastern Bank)', 'Unicorn Distribution Limited', '429-432, Tejgaon I/A, Dhaka -1208', '01825-159159', 'md.yeasin@shopup.org',
  'Ataur Rahim Chowdhury', 'Managing Director', 'Eastern Bank Limited', 'Gulshan', '095261720', 'EBLDBDDHXXX', 'UNICORN DISTRIBUTION LTD.', '1041360003011',
  'ARE.MSH.BE', 'VEG/SU/',
  '{"country_of_origin":"BANGLADESH","carriage_by":"Air","departure_port":"DHAKA, BANGLADESH","payment_terms":"Advance TT, Part TT, After Receiving the TT","tolerance_pct":10,"notify_parties":[{"name":"SILQ PTE. LTD.","address":"33A PAGODA STREET, SINGAPORE, 059192, REPUBLIC OF SINGAPORE."},{"name":"BRIDGE GLOBAL SDN. BHD.","address":"NO 37D MEDAN BAYAN LEPAS TAMAN PERINDUSTRIAN BAYAN LEPAS FAS, MALAYSIA."}]}'::jsonb,
  true);

insert into public.buyers(name, cr_no, vat_no, address, country, point_of_entry) values
  ('MODERN FRUITS EST.', '1010743095', '310657003400003', '7772, AL HAIR ROAD, FACTORIES AREA, 4712, RIYADH K.S.A', 'KSA', 'Jeddah/RIYADH/ Int''L Airport, K.S.A'),
  ('Samar Al Shamal Trading Est.', '1010564476', null, 'Al Rabeeh St., Al Naseem, RIYADH, K.S.A', 'KSA', 'Jeddah/RIYADH/ Int''L Airport, K.S.A')
on conflict do nothing;

insert into public.products(description, carton_size, hs_code, incoterm, rate_usd_per_kg) values
  ('VEGETABLE', '1 KG x 10 PCS', '0711 90 00', 'CFR', 2.20),
  ('FRESH BETEL LEAVES', '1 KG x 9 PCS', '1404 90 92', 'CFR', 6.40)
on conflict do nothing;

-- ===== Overview: masters links, contract signed flag, follow-ups done =====
create or replace view public.trade_overview with (security_invoker = true) as
 SELECT id, code, exporter, exporter_address, exporter_phone, exporter_email, importer_name, importer_country, buyer_cr_no, buyer_vat_no, buyer_address,
    notify_parties, products, sales_contract_no, contract_date, shipping_mark, country_of_origin, country_of_destination, expiry_date, shipment_timeline,
    carriage_by, departure_port, point_of_entry, payment_type, payment_terms, tolerance_pct, bank_name, bank_branch, bank_routing_no, bank_swift,
    bank_account_name, bank_account_no, incentive_terms, notes, contract_amount, contract_amount_usd, exchange_rate, currency, contract_extra, status,
    created_by, approved_by, approved_at, rejection_reason, is_demo, created_at, updated_at,
    COALESCE(( SELECT sum(e.amount) FROM exps e WHERE e.trade_id = t.id), 0::numeric)::numeric(16,2) AS exp_issued,
    (( SELECT sum(e.amount_usd) FROM exps e WHERE e.trade_id = t.id))::numeric(14,2) AS exp_issued_usd,
    COALESCE(( SELECT sum(c.amount) FROM collections c WHERE c.trade_id = t.id AND c.status = 'approved'::approval_status), 0::numeric)::numeric(16,2) AS collected,
    (( SELECT sum(c.amount_usd) FROM collections c WHERE c.trade_id = t.id AND c.status = 'approved'::approval_status))::numeric(14,2) AS collected_usd,
    (( SELECT count(*) FROM exps e WHERE e.trade_id = t.id))::integer AS exp_count,
    ( SELECT a.id FROM trade_amendments a WHERE a.trade_id = t.id AND a.status = 'pending_approval'::approval_status LIMIT 1) AS pending_revision_id,
    ( SELECT max(a.amendment_no) FROM trade_amendments a WHERE a.trade_id = t.id AND a.status = 'approved'::approval_status) AS latest_amendment_no,
    company_profile_id, buyer_id, shipment_deadline,
    EXISTS ( SELECT 1 FROM contract_documents d WHERE d.trade_id = t.id AND d.status = 'signed') AS contract_signed,
    ( SELECT count(*) FROM contract_documents d WHERE d.trade_id = t.id)::integer AS contract_versions,
    COALESCE(( SELECT array_agg(f.checkpoint ORDER BY f.checkpoint) FROM trade_followups f WHERE f.trade_id = t.id), '{}'::int[]) AS followups_done
   FROM trades t;

-- ===== Keep shipment_deadline in step when an amendment changes the timeline =====
create or replace function public.trg_trade_deadline() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.shipment_timeline is distinct from old.shipment_timeline and new.shipment_timeline ~ '\d{1,2}/\d{1,2}/\d{4}' then
    new.shipment_deadline := to_date(substring(new.shipment_timeline from '(\d{1,2}/\d{1,2}/\d{4})'), 'DD/MM/YYYY');
  end if;
  return new;
end $$;
drop trigger if exists trades_deadline on public.trades;
create trigger trades_deadline before update of shipment_timeline on public.trades
  for each row execute function public.trg_trade_deadline();
