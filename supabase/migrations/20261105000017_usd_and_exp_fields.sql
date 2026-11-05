-- Export Panel review changes (Nov 2026)
-- 1. Back up money tables.
-- 2. Book everything in USD: amount columns now hold USD. Existing BDT values are converted at each
--    trade's own exchange rate (rate derived from contract BDT / USD when no rate was saved);
--    an EXP's or collection's entered USD figure wins.
-- 3. EXP template fields (23), EXP number unique by serial + year, 8 fields locked once set,
--    bulk upload / bulk update RPC with a preview mode.

-- ---------------------------------------------------------------- 1. backup
create schema if not exists backup_20261105;
revoke all on schema backup_20261105 from public, anon, authenticated;
create table if not exists backup_20261105.trades as table public.trades;
create table if not exists backup_20261105.trade_items as table public.trade_items;
create table if not exists backup_20261105.trade_amendments as table public.trade_amendments;
create table if not exists backup_20261105.exps as table public.exps;
create table if not exists backup_20261105.exp_amount_changes as table public.exp_amount_changes;
create table if not exists backup_20261105.collections as table public.collections;
create table if not exists backup_20261105.collection_exps as table public.collection_exps;
create table if not exists backup_20261105.incentives as table public.incentives;
create table if not exists backup_20261105.incentive_exps as table public.incentive_exps;
create table if not exists backup_20261105.activity_log as table public.activity_log;

-- ---------------------------------------------------------------- 2. convert to USD
select set_config('app.exp_amount_change', 'on', true);

create temp table _rate on commit drop as
select t.id, coalesce(nullif(t.exchange_rate, 0),
         case when coalesce(t.contract_amount_usd, 0) > 0 then t.contract_amount / t.contract_amount_usd end, 1)::numeric as r,
       upper(coalesce(t.currency, 'BDT')) as cur
from public.trades t;
-- trades already booked in USD are left as they are
delete from _rate where cur = 'USD';

update public.trade_items i set
  rate_per_kg = round(i.rate_per_kg / x.r, 4),
  rate_usd_per_kg = round(i.rate_per_kg / x.r, 4),
  line_total = round(i.line_total / x.r, 2)
from _rate x where x.id = i.trade_id;

update public.trades t set
  contract_amount = coalesce((select sum(line_total) from public.trade_items i where i.trade_id = t.id), round(t.contract_amount / x.r, 2)),
  contract_amount_usd = coalesce((select sum(line_total) from public.trade_items i where i.trade_id = t.id), round(t.contract_amount / x.r, 2)),
  currency = 'USD'
from _rate x where x.id = t.id;

update public.trade_amendments a set
  old_amount = round(a.old_amount / x.r, 2),
  new_amount = round(a.new_amount / x.r, 2),
  old_items = (select coalesce(jsonb_agg(it || jsonb_build_object(
      'rate_per_kg', round(nullif(it->>'rate_per_kg','')::numeric / x.r, 4),
      'rate_usd_per_kg', round(nullif(it->>'rate_per_kg','')::numeric / x.r, 4),
      'line_total', round(nullif(it->>'line_total','')::numeric / x.r, 2)) order by o), a.old_items)
    from jsonb_array_elements(case when jsonb_typeof(a.old_items) = 'array' then a.old_items else '[]'::jsonb end) with ordinality q(it, o)),
  new_items = (select coalesce(jsonb_agg(it || jsonb_build_object(
      'rate_per_kg', round(nullif(it->>'rate_per_kg','')::numeric / x.r, 4),
      'rate_usd_per_kg', round(nullif(it->>'rate_per_kg','')::numeric / x.r, 4),
      'line_total', round(nullif(it->>'line_total','')::numeric / x.r, 2)) order by o), a.new_items)
    from jsonb_array_elements(case when jsonb_typeof(a.new_items) = 'array' then a.new_items else '[]'::jsonb end) with ordinality q(it, o))
from _rate x where x.id = a.trade_id;

update public.exps e set
  amount = coalesce(e.amount_usd, round(e.amount / x.r, 2)),
  amount_usd = coalesce(e.amount_usd, round(e.amount / x.r, 2)),
  issued_amount = coalesce(e.issued_amount_usd, round(e.issued_amount / x.r, 2)),
  issued_amount_usd = coalesce(e.issued_amount_usd, round(e.issued_amount / x.r, 2))
from _rate x where x.id = e.trade_id;

update public.exp_amount_changes c set
  old_amount = coalesce(c.old_amount_usd, round(c.old_amount / x.r, 2)),
  new_amount = coalesce(c.new_amount_usd, round(c.new_amount / x.r, 2)),
  old_amount_usd = coalesce(c.old_amount_usd, round(c.old_amount / x.r, 2)),
  new_amount_usd = coalesce(c.new_amount_usd, round(c.new_amount / x.r, 2))
from _rate x where x.id = c.trade_id;

-- collection and incentive lines: the EXP's converted amount when the line carried the full EXP amount
update public.collection_exps ce set amount = case when ce.amount = b.amount then e.amount else round(ce.amount / x.r, 2) end
from backup_20261105.exps b, public.exps e, _rate x
where b.id = ce.exp_id and e.id = ce.exp_id and x.id = e.trade_id;
update public.incentive_exps ie set amount = case when ie.amount = b.amount then e.amount else round(ie.amount / x.r, 2) end
from backup_20261105.exps b, public.exps e, _rate x
where b.id = ie.exp_id and e.id = ie.exp_id and x.id = e.trade_id;

update public.collections c set
  amount = coalesce((select sum(amount) from public.collection_exps ce where ce.collection_id = c.id), round(c.amount / x.r, 2)),
  amount_usd = coalesce((select sum(amount) from public.collection_exps ce where ce.collection_id = c.id), round(c.amount / x.r, 2))
from _rate x where x.id = c.trade_id;

with ir as (
  select i.id, max(x.r) as r from public.incentives i
  join public.incentive_exps ie on ie.incentive_id = i.id join public.exps e on e.id = ie.exp_id
  join _rate x on x.id = e.trade_id group by i.id)
update public.incentives i set
  net_proceed = coalesce(i.net_proceed_usd, round(i.net_proceed / ir.r, 2)),
  freight = coalesce(i.freight_usd, round(i.freight / ir.r, 2)),
  net_proceed_usd = coalesce(i.net_proceed_usd, round(i.net_proceed / ir.r, 2)),
  freight_usd = coalesce(i.freight_usd, round(i.freight / ir.r, 2)),
  exp_amount = (select sum(amount) from public.incentive_exps ie where ie.incentive_id = i.id)
from ir where ir.id = i.id;
update public.incentives i set fob = round(net_proceed - freight, 2), incentive_amount = round((net_proceed - freight) * incentive_pct / 100, 2)
where i.id in (select incentive_id from public.incentive_exps ie join public.exps e on e.id = ie.exp_id join _rate x on x.id = e.trade_id);

-- activity history amounts
update public.activity_log l set details = l.details
  || case when l.details ? 'amount' and jsonb_typeof(l.details->'amount') = 'number' then jsonb_build_object('amount', round((l.details->>'amount')::numeric / x.r, 2)) else '{}'::jsonb end
  || case when l.details ? 'old_amount' and jsonb_typeof(l.details->'old_amount') = 'number' then jsonb_build_object('old_amount', round((l.details->>'old_amount')::numeric / x.r, 2)) else '{}'::jsonb end
  || case when l.details ? 'new_amount' and jsonb_typeof(l.details->'new_amount') = 'number' then jsonb_build_object('new_amount', round((l.details->>'new_amount')::numeric / x.r, 2)) else '{}'::jsonb end
from _rate x where x.id = l.trade_id and l.created_at < now();

select set_config('app.exp_amount_change', 'off', true);
-- run the deferred total checks now so the tables can be altered below
set constraints all immediate;
alter table public.trades alter column currency set default 'USD';

-- ---------------------------------------------------------------- 2b. money helpers now print USD
create or replace function public.fmt_usd(v numeric) returns text language sql immutable as $$
  select case when coalesce(v,0) < 0 then '-$' else '$' end || to_char(abs(coalesce(v,0)), 'FM999,999,999,999,990.00')
$$;
-- old name kept so existing functions print USD
create or replace function public.fmt_bdt(v numeric) returns text language sql immutable as $$ select public.fmt_usd(v) $$;

create or replace function public.normalize_items(p_items jsonb)
 returns jsonb language plpgsql immutable as $function$
declare r jsonb; out jsonb := '[]'::jsonb; q numeric; ru numeric; i int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item line';
  end if;
  for r in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    if coalesce(trim(r->>'description'),'') = '' then raise exception 'Item % needs a description', i; end if;
    q := nullif(r->>'quantity_kg','')::numeric;
    ru := coalesce(nullif(r->>'rate_usd_per_kg','')::numeric, nullif(r->>'rate_per_kg','')::numeric);
    if q is null or q <= 0 then raise exception 'Item % needs a quantity above 0', i; end if;
    if ru is null or ru <= 0 then raise exception 'Item % needs a USD rate above 0', i; end if;
    out := out || jsonb_build_object('description', trim(r->>'description'), 'carton_size', nullif(trim(r->>'carton_size'),''),
      'hs_code', nullif(trim(r->>'hs_code'),''), 'incoterm', nullif(trim(r->>'incoterm'),''),
      'quantity_kg', round(q,3), 'rate_per_kg', round(ru,4), 'rate_usd_per_kg', round(ru,4), 'line_total', round(q*ru,2));
  end loop;
  return out;
end $function$;

create or replace function public.create_trade(p_data jsonb, p_items jsonb, p_file jsonb)
 returns uuid language plpgsql security definer set search_path to 'public' as $function$
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
    round(v_amount,2), null, 'USD',
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

-- ---------------------------------------------------------------- 3. EXP template fields
alter table public.exps
  add column if not exists lc_contract text,
  add column if not exists importer text,
  add column if not exists exp_serial text,
  add column if not exists exp_year int,
  add column if not exists entry_date date,
  add column if not exists hs_code text,
  add column if not exists unit_iso text,
  add column if not exists incoterm text,
  add column if not exists quantity numeric,
  add column if not exists freight numeric,
  add column if not exists dest_port text,
  add column if not exists dup_flag text,
  add column if not exists dup_date date,
  add column if not exists invoice_no text,
  add column if not exists invoice_date date,
  add column if not exists carrier text,
  add column if not exists trans_doc_date date,
  add column if not exists custom_code text,
  add column if not exists export_bill_no text,
  add column if not exists export_bill_date date;

comment on column public.exps.awb_no is 'Trans Doc No (AWB number for air shipments)';
comment on column public.exps.shipment_date is 'Ship Date';
comment on column public.exps.amount is 'Amount Inv, USD';
comment on column public.exps.type is 'advance = Advance EXP, regular = Duplicate EXP';

create unique index if not exists exps_serial_year_uq on public.exps (ltrim(exp_serial, '0'), exp_year)
  where exp_serial is not null and exp_year is not null;

-- defaults on insert: issued amount, Lc Contact and Importer from the trade
create or replace function public.trg_exp_issued()
 returns trigger language plpgsql set search_path to 'public' as $function$
declare v_t public.trades;
begin
  new.issued_amount := coalesce(new.issued_amount, new.amount);
  new.issued_amount_usd := coalesce(new.issued_amount_usd, new.amount_usd, new.amount);
  select * into v_t from public.trades where id = new.trade_id;
  new.lc_contract := coalesce(nullif(trim(new.lc_contract),''), v_t.sales_contract_no);
  new.importer := coalesce(nullif(trim(new.importer),''), v_t.importer_name);
  return new;
end $function$;

-- EXP number shown as serial/year
create or replace function public.trg_exp_number()
 returns trigger language plpgsql as $function$
begin
  new.exp_serial := nullif(trim(new.exp_serial), '');
  if new.exp_serial is not null and new.exp_year is not null then
    new.exp_no := new.exp_serial || '/' || new.exp_year;
  end if;
  new.amount_usd := new.amount;
  return new;
end $function$;
drop trigger if exists exp_number on public.exps;
create trigger exp_number before insert or update on public.exps for each row execute function public.trg_exp_number();

-- 8 template fields lock once set; closed EXP amounts stay locked
create or replace function public.trg_exp_lock()
 returns trigger language plpgsql as $function$
begin
  if old.status = 'closed' and new.amount is distinct from old.amount
     and coalesce(current_setting('app.exp_amount_change', true), '') <> 'on' then
    raise exception 'EXP % is closed, its amount is locked', old.code;
  end if;
  if coalesce(current_setting('app.exp_unlock', true), '') <> 'on' then
    if old.lc_contract is not null and new.lc_contract is distinct from old.lc_contract then raise exception 'Lc Contact on % is locked', old.code; end if;
    if old.importer is not null and new.importer is distinct from old.importer then raise exception 'Importer on % is locked', old.code; end if;
    if old.exp_serial is not null and new.exp_serial is distinct from old.exp_serial then raise exception 'EXP Serial on % is locked', old.code; end if;
    if old.exp_year is not null and new.exp_year is distinct from old.exp_year then raise exception 'EXP Year on % is locked', old.code; end if;
    if old.entry_date is not null and new.entry_date is distinct from old.entry_date then raise exception 'Entry Date on % is locked', old.code; end if;
    if old.hs_code is not null and new.hs_code is distinct from old.hs_code then raise exception 'HSCODE on % is locked', old.code; end if;
    if old.unit_iso is not null and new.unit_iso is distinct from old.unit_iso then raise exception 'Unit ISO on % is locked', old.code; end if;
    if old.incoterm is not null and new.incoterm is distinct from old.incoterm then raise exception 'Incoterm on % is locked', old.code; end if;
  end if;
  return new;
end $function$;

-- which template fields are still empty
create or replace function public.exp_missing(e public.exps, p_duplicate boolean)
 returns text[] language sql stable as $$
  select array_remove(array[
    case when e.lc_contract is null then 'Lc Contact' end,
    case when e.importer is null then 'Importer' end,
    case when e.exp_serial is null then 'EXP Serial' end,
    case when e.exp_year is null then 'EXP Year' end,
    case when e.entry_date is null then 'Entry Date' end,
    case when e.hs_code is null then 'HSCODE' end,
    case when e.unit_iso is null then 'Unit ISO' end,
    case when e.incoterm is null then 'Incoterm' end,
    case when e.quantity is null then 'Quantity' end,
    case when e.amount is null then 'Amount Inv' end,
    case when e.freight is null then 'Freight' end,
    case when p_duplicate and e.dest_port is null then 'Dest Port' end,
    case when p_duplicate and e.shipment_date is null then 'Ship Date' end,
    case when p_duplicate and e.dup_flag is null then 'Dup Flag' end,
    case when p_duplicate and e.dup_date is null then 'Dup Date' end,
    case when p_duplicate and e.invoice_no is null then 'Invoice No' end,
    case when p_duplicate and e.invoice_date is null then 'Invoice Date' end,
    case when p_duplicate and e.carrier is null then 'Carrier' end,
    case when p_duplicate and e.awb_no is null then 'Trans Doc No' end,
    case when p_duplicate and e.trans_doc_date is null then 'Trans Doc Date' end,
    case when p_duplicate and e.custom_code is null then 'Custom Code' end,
    case when p_duplicate and e.export_bill_no is null then 'Export Bill No' end,
    case when p_duplicate and e.export_bill_date is null then 'Export Bill Date' end
  ], null)
$$;

-- apply the template fields present in p_fields to an EXP row (absent keys unchanged, '' clears)
create or replace function public.exp_apply_fields(e public.exps, f jsonb)
 returns public.exps language plpgsql immutable as $function$
declare
  t text[] := array['lc_contract','importer','exp_serial','unit_iso','incoterm','hs_code','dest_port','dup_flag','invoice_no','carrier','awb_no','custom_code','export_bill_no','shipment_id','flight_no'];
  d text[] := array['entry_date','shipment_date','dup_date','invoice_date','trans_doc_date','export_bill_date'];
  k text; v text;
begin
  if f is null then return e; end if;
  foreach k in array t loop
    if f ? k then
      v := nullif(trim(f->>k), '');
      case k
        when 'lc_contract' then e.lc_contract := v; when 'importer' then e.importer := v;
        when 'exp_serial' then e.exp_serial := v; when 'unit_iso' then e.unit_iso := upper(v);
        when 'incoterm' then e.incoterm := upper(v); when 'hs_code' then e.hs_code := v;
        when 'dest_port' then e.dest_port := v; when 'dup_flag' then e.dup_flag := upper(v);
        when 'invoice_no' then e.invoice_no := v; when 'carrier' then e.carrier := v;
        when 'awb_no' then e.awb_no := v; when 'custom_code' then e.custom_code := v;
        when 'export_bill_no' then e.export_bill_no := v; when 'shipment_id' then e.shipment_id := v;
        when 'flight_no' then e.flight_no := v;
      end case;
    end if;
  end loop;
  foreach k in array d loop
    if f ? k then
      v := nullif(trim(f->>k), '');
      begin
        case k
          when 'entry_date' then e.entry_date := v::date; when 'shipment_date' then e.shipment_date := v::date;
          when 'dup_date' then e.dup_date := v::date; when 'invoice_date' then e.invoice_date := v::date;
          when 'trans_doc_date' then e.trans_doc_date := v::date; when 'export_bill_date' then e.export_bill_date := v::date;
        end case;
      exception when others then raise exception '% is not a valid date: %', replace(initcap(replace(k,'_',' ')),'Exp ','EXP '), v;
      end;
    end if;
  end loop;
  if f ? 'exp_year' then
    v := nullif(trim(f->>'exp_year'), '');
    if v is not null and v !~ '^\d{4}$' then raise exception 'EXP Year must be a 4-digit year: %', v; end if;
    e.exp_year := v::int;
  end if;
  if f ? 'quantity' then
    v := nullif(trim(f->>'quantity'), '');
    if v is not null and (v !~ '^\d+(\.\d+)?$' or v::numeric <= 0) then raise exception 'Quantity must be a number above 0: %', v; end if;
    e.quantity := v::numeric;
  end if;
  if f ? 'freight' then
    v := nullif(trim(f->>'freight'), '');
    if v is not null and (v !~ '^\d+(\.\d+)?$') then raise exception 'Freight must be a number: %', v; end if;
    e.freight := round(v::numeric, 2);
  end if;
  return e;
end $function$;

drop function if exists public.create_exp(uuid, numeric, boolean, jsonb);
create or replace function public.create_exp(p_trade uuid, p_amount numeric, p_advance boolean, p_fields jsonb)
 returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_t public.trades; v_total numeric; v_e public.exps; v_id uuid; v_code text; v_miss text[];
begin
  perform public.require_member();
  select * into v_t from public.trades where id = p_trade;
  if v_t.id is null then raise exception 'Trade not found'; end if;
  if v_t.status <> 'active' then raise exception 'EXPs can only be added to active trades (% is %)', v_t.code, v_t.status; end if;
  if not exists (select 1 from public.contract_documents where trade_id = p_trade and status = 'signed') then
    raise exception 'Upload the signed sales contract for % and mark it signed before adding EXPs', v_t.code;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount Inv must be greater than 0'; end if;
  select coalesce(sum(amount),0) into v_total from public.exps where trade_id = p_trade;
  if v_total + p_amount > v_t.contract_amount then
    raise exception 'EXP total % exceeds the contract amount % on %. Available: %', public.fmt_usd(v_total + p_amount), public.fmt_usd(v_t.contract_amount), v_t.code, public.fmt_usd(v_t.contract_amount - v_total);
  end if;
  v_e.trade_id := p_trade;
  v_e.amount := round(p_amount, 2);
  v_e.type := case when coalesce(p_advance, true) then 'advance'::public.exp_type else 'regular'::public.exp_type end;
  v_e := public.exp_apply_fields(v_e, p_fields);
  v_e.lc_contract := coalesce(v_e.lc_contract, v_t.sales_contract_no);
  v_e.importer := coalesce(v_e.importer, v_t.importer_name);
  v_miss := public.exp_missing(v_e, v_e.type = 'regular');
  if array_length(v_miss, 1) is not null then
    raise exception '% EXP needs: %', case when v_e.type = 'regular' then 'Duplicate' else 'Advance' end, array_to_string(v_miss, ', ');
  end if;
  if exists (select 1 from public.exps where ltrim(exp_serial,'0') = ltrim(v_e.exp_serial,'0') and exp_year = v_e.exp_year) then
    raise exception 'EXP %/% already exists', v_e.exp_serial, v_e.exp_year;
  end if;
  insert into public.exps(trade_id, amount, amount_usd, type, created_by, lc_contract, importer, exp_serial, exp_year, entry_date, hs_code, unit_iso, incoterm,
    quantity, freight, dest_port, shipment_date, dup_flag, dup_date, invoice_no, invoice_date, carrier, awb_no, trans_doc_date, custom_code,
    export_bill_no, export_bill_date, shipment_id, flight_no)
  values (p_trade, v_e.amount, v_e.amount, v_e.type, auth.uid(), v_e.lc_contract, v_e.importer, v_e.exp_serial, v_e.exp_year, v_e.entry_date, v_e.hs_code,
    v_e.unit_iso, v_e.incoterm, v_e.quantity, v_e.freight, v_e.dest_port, v_e.shipment_date, v_e.dup_flag, v_e.dup_date, v_e.invoice_no,
    v_e.invoice_date, v_e.carrier, v_e.awb_no, v_e.trans_doc_date, v_e.custom_code, v_e.export_bill_no, v_e.export_bill_date, v_e.shipment_id, v_e.flight_no)
  returning id, code into v_id, v_code;
  perform public.log_activity('exp', v_id, p_trade, 'exp_created', jsonb_build_object('code', v_code, 'amount', v_e.amount, 'advance', v_e.type = 'advance'));
  return v_id;
end $function$;

-- p_fields: only the keys given are changed ('' clears an unlocked field). p_fields->>'type' = advance | regular (duplicate).
drop function if exists public.update_exp(uuid, numeric, jsonb);
create or replace function public.update_exp(p_id uuid, p_amount numeric, p_fields jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_old public.exps; v_e public.exps; v_type text := lower(nullif(trim(p_fields->>'type'),'')); v_before text[]; v_after text[]; v_dup boolean;
begin
  perform public.require_member();
  select * into v_old from public.exps where id = p_id for update;
  if v_old.id is null then raise exception 'EXP not found'; end if;
  if p_amount is not null and round(p_amount,2) <> v_old.amount then
    raise exception 'Amount Inv on % can only change through Change amount (reason, document and admin approval)', v_old.code;
  end if;
  v_e := public.exp_apply_fields(v_old, p_fields - 'type');
  if v_type is not null then
    if v_type in ('advance') then v_e.type := 'advance';
    elsif v_type in ('regular','duplicate','duplicated') then v_e.type := 'regular';
    else raise exception 'EXP Type must be Advance or Duplicate'; end if;
  end if;
  if v_old.type = 'regular' and v_e.type = 'advance' then raise exception '% is a Duplicate EXP and cannot go back to Advance', v_old.code; end if;
  v_dup := v_e.type = 'regular';
  v_before := public.exp_missing(v_old, v_dup);
  v_after := public.exp_missing(v_e, v_dup);
  if v_dup and v_old.type = 'advance' and array_length(v_after, 1) is not null then
    raise exception 'To make % a Duplicate EXP, fill: %', v_old.code, array_to_string(v_after, ', ');
  end if;
  if exists (select 1 from unnest(v_after) m where m <> all(coalesce(v_before, '{}'))) then
    raise exception '% cannot be emptied on %', array_to_string(array(select m from unnest(v_after) m where m <> all(coalesce(v_before,'{}'))), ', '), v_old.code;
  end if;
  if v_e.exp_serial is not null and v_e.exp_year is not null and exists (select 1 from public.exps where id <> p_id
       and ltrim(exp_serial,'0') = ltrim(v_e.exp_serial,'0') and exp_year = v_e.exp_year) then
    raise exception 'EXP %/% already exists', v_e.exp_serial, v_e.exp_year;
  end if;
  update public.exps set type = v_e.type, lc_contract = v_e.lc_contract, importer = v_e.importer, exp_serial = v_e.exp_serial, exp_year = v_e.exp_year,
    entry_date = v_e.entry_date, hs_code = v_e.hs_code, unit_iso = v_e.unit_iso, incoterm = v_e.incoterm, quantity = v_e.quantity, freight = v_e.freight,
    dest_port = v_e.dest_port, shipment_date = v_e.shipment_date, dup_flag = v_e.dup_flag, dup_date = v_e.dup_date, invoice_no = v_e.invoice_no,
    invoice_date = v_e.invoice_date, carrier = v_e.carrier, awb_no = v_e.awb_no, trans_doc_date = v_e.trans_doc_date, custom_code = v_e.custom_code,
    export_bill_no = v_e.export_bill_no, export_bill_date = v_e.export_bill_date, shipment_id = v_e.shipment_id, flight_no = v_e.flight_no
  where id = p_id;
  perform public.log_activity('exp', p_id, v_old.trade_id, case when v_dup and v_old.type = 'advance' then 'exp_duplicated' else 'exp_updated' end,
    jsonb_build_object('code', v_old.code));
end $function$;

-- Bulk upload (p_mode 'create') and bulk update (p_mode 'update'). Each row is checked on its own.
-- p_commit false = preview: every row runs, then everything is rolled back and the row results returned.
-- Row shape: {"n":2, "trade_code":"TRD-0003", "type":"Advance", "amount":"1200", "fields":{...template fields...}}
-- For update, the EXP is found by fields.exp_serial + fields.exp_year.
create or replace function public.bulk_exps(p_mode text, p_rows jsonb, p_commit boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r jsonb; v_res jsonb := '[]'::jsonb; v_id uuid; v_code text; v_trade uuid; v_seq bigint; v_ok int := 0; v_err int := 0;
  v_type text; v_amount numeric; v_f jsonb; v_serial text; v_year int;
begin
  perform public.require_member();
  if p_mode not in ('create','update') then raise exception 'Mode must be create or update'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'No rows to process'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Upload at most 2000 rows at a time'; end if;
  select last_value into v_seq from public.exp_code_seq;
  begin
    for r in select * from jsonb_array_elements(p_rows) loop
      begin
        v_f := coalesce(r->'fields', '{}'::jsonb);
        v_type := lower(nullif(trim(r->>'type'),''));
        if nullif(trim(r->>'amount'),'') is not null and trim(r->>'amount') !~ '^\d+(\.\d+)?$' then
          raise exception 'Amount Inv must be a number: %', r->>'amount';
        end if;
        v_amount := nullif(trim(r->>'amount'),'')::numeric;
        if p_mode = 'create' then
          select id into v_trade from public.trades where upper(code) = upper(trim(r->>'trade_code'));
          if v_trade is null then raise exception 'Trade % not found', coalesce(nullif(trim(r->>'trade_code'),''), '(empty)'); end if;
          if v_type is not null and v_type not in ('advance','duplicate','duplicated','regular') then raise exception 'EXP Type must be Advance or Duplicate'; end if;
          v_id := public.create_exp(v_trade, v_amount, coalesce(v_type,'advance') = 'advance', v_f);
        else
          v_serial := nullif(trim(v_f->>'exp_serial'),'');
          if v_serial is null or nullif(trim(v_f->>'exp_year'),'') is null then raise exception 'EXP Serial and EXP Year are needed to find the EXP'; end if;
          v_year := (v_f->>'exp_year')::int;
          select id into v_id from public.exps where ltrim(exp_serial,'0') = ltrim(v_serial,'0') and exp_year = v_year;
          if v_id is null then raise exception 'EXP %/% not found', v_serial, v_year; end if;
          if nullif(trim(r->>'trade_code'),'') is not null and not exists (select 1 from public.exps e join public.trades t on t.id = e.trade_id
               where e.id = v_id and upper(t.code) = upper(trim(r->>'trade_code'))) then
            raise exception 'EXP %/% is not under %', v_serial, v_year, trim(r->>'trade_code');
          end if;
          perform public.update_exp(v_id, v_amount, (v_f - 'exp_serial' - 'exp_year' - 'lc_contract' - 'importer') || case when v_type is not null then jsonb_build_object('type', v_type) else '{}'::jsonb end);
        end if;
        select code into v_code from public.exps where id = v_id;
        v_res := v_res || jsonb_build_object('n', r->'n', 'ok', true, 'code', v_code);
        v_ok := v_ok + 1;
      exception when others then
        v_res := v_res || jsonb_build_object('n', r->'n', 'ok', false, 'error', sqlerrm);
        v_err := v_err + 1;
      end;
    end loop;
    if not coalesce(p_commit, false) then raise exception 'bulk_exps_preview'; end if;
  exception when others then
    if sqlerrm <> 'bulk_exps_preview' then raise; end if;
    perform setval('public.exp_code_seq', v_seq, true);
  end;
  return jsonb_build_object('ok', v_ok, 'errors', v_err, 'committed', coalesce(p_commit,false), 'rows', v_res);
end $function$;
grant execute on function public.bulk_exps(text, jsonb, boolean) to authenticated;
grant execute on function public.create_exp(uuid, numeric, boolean, jsonb) to authenticated;
grant execute on function public.update_exp(uuid, numeric, jsonb) to authenticated;

-- documents open once the EXP has shipped (Ship Date, shipment ID, or Duplicate)
create or replace function public.upload_exp_document(p_doc uuid, p_file jsonb, p_stage text default null, p_note text default null, p_submitted_on date default null)
 returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_d public.exp_documents; v_e public.exps; v_ver int; v_id uuid;
begin
  perform public.require_member();
  select * into v_d from public.exp_documents where id = p_doc for update;
  if v_d.id is null then raise exception 'Document not found'; end if;
  select * into v_e from public.exps where id = v_d.exp_id;
  if v_d.status = 'final' then raise exception '% is final. Its lifecycle is closed.', v_d.doc_type; end if;
  if v_e.type = 'advance' and v_e.shipment_id is null and v_e.shipment_date is null then
    raise exception 'Add the Ship Date to % before uploading documents', v_e.code;
  end if;
  if p_file is null or coalesce(p_file->>'path','') = '' then raise exception 'File is required'; end if;
  select coalesce(max(version),0) + 1 into v_ver from public.exp_document_versions where doc_id = p_doc;
  insert into public.exp_document_versions(doc_id, exp_id, version, stage, submitted_on, note, file_path, file_name, file_size, uploaded_by, is_demo)
  values (p_doc, v_d.exp_id, v_ver, nullif(trim(p_stage),''), coalesce(p_submitted_on, current_date), nullif(trim(p_note),''),
    p_file->>'path', coalesce(p_file->>'name','file'), nullif(p_file->>'size','')::bigint, auth.uid(), v_d.is_demo)
  returning id into v_id;
  update public.exp_documents set status = 'uploaded', file_path = p_file->>'path', file_name = coalesce(p_file->>'name','file'),
    file_size = nullif(p_file->>'size','')::bigint, uploaded_by = auth.uid(), uploaded_at = now(),
    version_count = v_ver, latest_stage = nullif(trim(p_stage),'')
  where id = p_doc;
  perform public.log_activity('exp_document', p_doc, v_e.trade_id, 'document_uploaded',
    jsonb_build_object('code', v_e.code, 'doc', v_d.doc_type || ' v' || v_ver || coalesce(' (' || nullif(trim(p_stage),'') || ')', '')));
  return v_id;
end $function$;

-- overview: template fields appended
create or replace view public.exp_overview with (security_invoker = true) as
 SELECT e.id, e.code, e.trade_id, e.shipment_id, e.exp_no, e.awb_no, e.flight_no, e.shipment_date, e.amount, e.amount_usd, e.type, e.status,
    e.created_by, e.is_demo, e.created_at, e.closed_at, t.code AS trade_code, t.importer_name, t.status AS trade_status,
    ( SELECT c.status FROM collection_exps ce JOIN collections c ON c.id = ce.collection_id
       WHERE ce.exp_id = e.id AND c.status = ANY (ARRAY['pending_approval'::approval_status, 'approved'::approval_status])
       ORDER BY c.created_at DESC LIMIT 1) AS collection_status,
    ( SELECT c.code FROM collection_exps ce JOIN collections c ON c.id = ce.collection_id
       WHERE ce.exp_id = e.id AND c.status = ANY (ARRAY['pending_approval'::approval_status, 'approved'::approval_status])
       ORDER BY c.created_at DESC LIMIT 1) AS collection_code,
    ( SELECT i.status FROM incentive_exps ie JOIN incentives i ON i.id = ie.incentive_id
       WHERE ie.exp_id = e.id AND i.status = ANY (ARRAY['pending_approval'::approval_status, 'approved'::approval_status])
       ORDER BY i.created_at DESC LIMIT 1) AS incentive_status,
    (( SELECT count(*) FROM exp_documents d WHERE d.exp_id = e.id AND d.status = 'final'::doc_status))::integer AS docs_final,
    (( SELECT count(*) FROM exp_documents d WHERE d.exp_id = e.id AND d.status <> 'missing'::doc_status))::integer AS docs_uploaded,
    (( SELECT count(*) FROM exp_documents d WHERE d.exp_id = e.id))::integer AS docs_total,
    e.issued_amount, e.issued_amount_usd,
    ( SELECT x.id FROM exp_amount_changes x WHERE x.exp_id = e.id AND x.status = 'pending_approval'::approval_status LIMIT 1) AS pending_amount_change_id,
    (( SELECT count(*) FROM exp_amount_changes x WHERE x.exp_id = e.id AND x.status = 'approved'::approval_status))::integer AS amount_changes,
    e.lc_contract, e.importer, e.exp_serial, e.exp_year, e.entry_date, e.hs_code, e.unit_iso, e.incoterm, e.quantity, e.freight,
    e.dest_port, e.dup_flag, e.dup_date, e.invoice_no, e.invoice_date, e.carrier, e.trans_doc_date, e.custom_code, e.export_bill_no, e.export_bill_date,
    t.sales_contract_no,
    coalesce(array_length(public.exp_missing(e, true), 1), 0) AS fields_missing
   FROM exps e JOIN trades t ON t.id = e.trade_id;
