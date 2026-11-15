-- Collections: PRS document, partial amounts per EXP, prepaid collections with later settlement,
-- and a Finance role that can view and approve collections and incentives only.
-- Adds columns, functions and an enum value; nothing is dropped and no existing row changes meaning.

-- 1. Finance role -----------------------------------------------------------------------------------
alter type public.app_role add value if not exists 'finance';

-- Operation and Admin may create and change records; Finance may not.
create or replace function public.require_member() returns void
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not public.is_member(auth.uid()) then
    raise exception 'You do not have access to ShopUp Export Console';
  end if;
  if exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'finance') then
    raise exception 'Finance can view and approve collections and incentives only';
  end if;
end $$;

-- Admin or Finance decide collections, settlements and incentives.
create or replace function public.require_approver() returns void
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role::text in ('admin','finance')
  ) or not public.is_member(auth.uid()) then
    raise exception 'Only Admin or Finance can approve this';
  end if;
end $$;

-- Read helpers stay open to every member, Finance included.
create or replace function public.pending_counts() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not public.is_member(auth.uid()) then
    raise exception 'You do not have access to ShopUp Export Console';
  end if;
  return jsonb_build_object(
    'trades', (select count(*) from public.trades where status in ('pending_approval','revision_pending')),
    'collections', (select count(*) from public.collections where status = 'pending_approval'),
    'incentives', (select count(*) from public.incentives where status = 'pending_approval'),
    'exp_amounts', (select count(*) from public.exp_amount_changes where status = 'pending_approval'));
end $$;

create or replace function public.demo_count() returns integer
language plpgsql stable security definer set search_path to 'public' as $$
declare n int;
begin
  if auth.uid() is null or not public.is_member(auth.uid()) then
    raise exception 'You do not have access to ShopUp Export Console';
  end if;
  select (select count(*) from public.trades where is_demo) + (select count(*) from public.exps where is_demo)
       + (select count(*) from public.collections where is_demo) + (select count(*) from public.incentives where is_demo)
       + (select count(*) from public.trade_amendments where is_demo)
    into n;
  return n;
end $$;

-- 2. Collection kinds -------------------------------------------------------------------------------
alter table public.collections
  add column if not exists kind text not null default 'exp',
  add column if not exists source_collection_id uuid references public.collections(id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'collections_kind_check') then
    alter table public.collections add constraint collections_kind_check check (kind in ('exp','prepaid','settlement'));
  end if;
end $$;
create index if not exists collection_exps_exp_idx on public.collection_exps(exp_id);
create index if not exists collections_source_idx on public.collections(source_collection_id);

-- Amount of an EXP taken by pending or approved collections (EXP and settlement kinds).
create or replace function public.exp_allocated(p_exp uuid) returns numeric
language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(ce.amount), 0) from public.collection_exps ce
  join public.collections c on c.id = ce.collection_id
  where ce.exp_id = p_exp and c.status in ('pending_approval','approved')
$$;

-- Amount of an EXP collected by approved collections only.
create or replace function public.exp_collected(p_exp uuid) returns numeric
language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(ce.amount), 0) from public.collection_exps ce
  join public.collections c on c.id = ce.collection_id
  where ce.exp_id = p_exp and c.status = 'approved'
$$;

-- Prepaid money still free to settle on a prepaid collection.
create or replace function public.prepaid_left(p_source uuid) returns numeric
language sql stable security definer set search_path to 'public' as $$
  select c.amount - coalesce((select sum(s.amount) from public.collections s
    where s.source_collection_id = c.id and s.kind = 'settlement' and s.status in ('pending_approval','approved')), 0)
  from public.collections c where c.id = p_source
$$;

-- Checks lines [{exp_id, amount}] against a trade; returns their total. Raises on any problem.
create or replace function public.check_collection_lines(p_trade uuid, p_lines jsonb) returns numeric
language plpgsql stable security definer set search_path to 'public' as $$
declare r jsonb; v_e public.exps; v_amt numeric; v_out numeric; v_total numeric := 0; v_seen uuid[] := '{}';
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Select at least one EXP';
  end if;
  for r in select * from jsonb_array_elements(p_lines) loop
    select * into v_e from public.exps where id = nullif(r->>'exp_id','')::uuid;
    if v_e.id is null or v_e.trade_id <> p_trade then raise exception 'All selected EXPs must belong to the selected trade'; end if;
    if v_e.id = any(v_seen) then raise exception 'EXP % is listed twice', v_e.code; end if;
    v_seen := v_seen || v_e.id;
    v_amt := round(nullif(r->>'amount','')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above 0 for %', v_e.code; end if;
    v_out := v_e.amount - public.exp_allocated(v_e.id);
    if v_amt > v_out then
      raise exception 'Amount for % is %, above its outstanding %', v_e.code, public.fmt_usd(v_amt), public.fmt_usd(greatest(v_out, 0));
    end if;
    v_total := v_total + v_amt;
  end loop;
  return v_total;
end $$;

-- 3. Submit a collection (EXP or prepaid) -----------------------------------------------------------
create or replace function public.submit_collection(
  p_trade uuid, p_amount numeric, p_bank_ref text, p_prepaid boolean, p_lines jsonb, p_docs jsonb
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_t public.trades; v_total numeric; v_prepaid numeric; v_id uuid; v_code text; d text; v_file jsonb; i int := 0;
  v_types text[] := array['Swift Message','Swift Copy','PRC','TT Voucher','PRS'];
  v_kind text := case when coalesce(p_prepaid, false) then 'prepaid' else 'exp' end;
begin
  perform public.require_member();
  select * into v_t from public.trades where id = p_trade;
  if v_t.id is null then raise exception 'Trade not found'; end if;
  if v_t.status not in ('active','revision_pending') then raise exception 'Collections can only be made on active trades'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount received must be greater than 0'; end if;
  if v_kind = 'prepaid' then
    if not exists (select 1 from public.contract_documents where trade_id = p_trade and status = 'signed') then
      raise exception 'Upload the signed sales contract for % and mark it signed before recording prepaid money', v_t.code;
    end if;
    if p_lines is not null and jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then
      raise exception 'A prepaid collection has no EXPs. Settle EXPs from it after approval.';
    end if;
    select coalesce(sum(amount), 0) into v_prepaid from public.collections
      where trade_id = p_trade and kind = 'prepaid' and status in ('pending_approval','approved');
    if v_prepaid + round(p_amount, 2) > v_t.contract_amount then
      raise exception 'Prepaid total % would be above the contract amount % on %', public.fmt_usd(v_prepaid + round(p_amount, 2)), public.fmt_usd(v_t.contract_amount), v_t.code;
    end if;
  else
    v_total := public.check_collection_lines(p_trade, p_lines);
    if v_total <> round(p_amount, 2) then
      raise exception 'EXP amounts total % must equal the amount received %', public.fmt_usd(v_total), public.fmt_usd(p_amount);
    end if;
  end if;
  select x into v_file from jsonb_array_elements(coalesce(p_docs,'[]'::jsonb)) x where x->>'doc_type' = 'Swift Message' limit 1;
  if v_file is null or coalesce(v_file->>'path','') = '' then raise exception 'Swift Message is required'; end if;

  insert into public.collections(trade_id, amount, amount_usd, bank_reference, kind, created_by)
  values (p_trade, round(p_amount,2), round(p_amount,2), nullif(trim(p_bank_ref),''), v_kind, auth.uid())
  returning id, code into v_id, v_code;
  if v_kind = 'exp' then
    insert into public.collection_exps(collection_id, exp_id, amount)
    select v_id, (x->>'exp_id')::uuid, round((x->>'amount')::numeric, 2) from jsonb_array_elements(p_lines) x;
  end if;
  foreach d in array v_types loop
    i := i + 1; v_file := null;
    select x into v_file from jsonb_array_elements(coalesce(p_docs,'[]'::jsonb)) x where x->>'doc_type' = d limit 1;
    if v_file is not null and coalesce(v_file->>'path','') <> '' then
      perform public.add_attachment('collection', v_id, d, v_file);
    else
      insert into public.documents(entity_type, entity_id, trade_id, doc_type, sort_order)
      values ('collection', v_id, p_trade, d, i) on conflict (entity_type, entity_id, doc_type) do nothing;
    end if;
  end loop;
  perform public.log_activity('collection', v_id, p_trade, case when v_kind = 'prepaid' then 'prepaid_created' else 'collection_created' end,
    jsonb_build_object('code', v_code, 'amount', round(p_amount,2)));
  return v_id;
end $$;

-- 4. Settle EXPs from an approved prepaid collection (no documents) ---------------------------------
create or replace function public.settle_prepaid(p_source uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_src public.collections; v_t public.trades; v_total numeric; v_left numeric; v_id uuid; v_code text;
begin
  perform public.require_member();
  select * into v_src from public.collections where id = p_source for update;
  if v_src.id is null or v_src.kind <> 'prepaid' then raise exception 'Prepaid collection not found'; end if;
  if v_src.status <> 'approved' then raise exception 'Prepaid collection % must be approved before settling EXPs', v_src.code; end if;
  select * into v_t from public.trades where id = v_src.trade_id;
  if v_t.status not in ('active','revision_pending','closed') then raise exception 'EXPs on % cannot be settled now', v_t.code; end if;
  v_total := public.check_collection_lines(v_src.trade_id, p_lines);
  v_left := public.prepaid_left(p_source);
  if v_total > v_left then
    raise exception 'Settlement % is above the prepaid balance % left on %', public.fmt_usd(v_total), public.fmt_usd(v_left), v_src.code;
  end if;
  insert into public.collections(trade_id, amount, amount_usd, kind, source_collection_id, created_by)
  values (v_src.trade_id, v_total, v_total, 'settlement', p_source, auth.uid())
  returning id, code into v_id, v_code;
  insert into public.collection_exps(collection_id, exp_id, amount)
  select v_id, (x->>'exp_id')::uuid, round((x->>'amount')::numeric, 2) from jsonb_array_elements(p_lines) x;
  perform public.log_activity('collection', v_id, v_src.trade_id, 'settlement_created',
    jsonb_build_object('code', v_code, 'amount', v_total, 'source', v_src.code));
  return v_id;
end $$;

-- 5. Approvals by Admin or Finance -----------------------------------------------------------------
create or replace function public.decide_collection(p_id uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_c public.collections;
begin
  perform public.require_approver();
  if not p_approve and coalesce(trim(p_reason),'') = '' then raise exception 'A rejection reason is required'; end if;
  select * into v_c from public.collections where id = p_id for update;
  if v_c.id is null or v_c.status <> 'pending_approval' then raise exception 'This collection is not awaiting approval'; end if;
  if p_approve and v_c.kind = 'settlement' then
    if (select status from public.collections where id = v_c.source_collection_id) <> 'approved' then
      raise exception 'The prepaid collection behind % is no longer approved', v_c.code;
    end if;
  end if;
  update public.collections set
    status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end,
    approved_by = auth.uid(), approved_at = now(),
    rejection_reason = case when p_approve then null else trim(p_reason) end
  where id = p_id returning * into v_c;
  perform public.log_activity('collection', p_id, v_c.trade_id,
    case when p_approve then 'collection_approved' else 'collection_rejected' end,
    jsonb_build_object('code', v_c.code, 'amount', v_c.amount, 'kind', v_c.kind, 'reason', p_reason));
end $$;

create or replace function public.decide_incentive(p_id uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_i public.incentives; v_trade uuid;
begin
  perform public.require_approver();
  if not p_approve and coalesce(trim(p_reason),'') = '' then raise exception 'A rejection reason is required'; end if;
  update public.incentives set
    status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end,
    approved_by = auth.uid(), approved_at = now(),
    rejection_reason = case when p_approve then null else trim(p_reason) end
  where id = p_id and status = 'pending_approval' returning * into v_i;
  if v_i.id is null then raise exception 'This incentive is not awaiting approval'; end if;
  for v_trade in select distinct e.trade_id from public.incentive_exps ie join public.exps e on e.id = ie.exp_id where ie.incentive_id = p_id loop
    perform public.log_activity('incentive', p_id, v_trade, case when p_approve then 'incentive_approved' else 'incentive_rejected' end,
      jsonb_build_object('code', v_i.code, 'amount', v_i.incentive_amount, 'reason', p_reason));
  end loop;
end $$;

-- 6. Incentives only on fully collected EXPs --------------------------------------------------------
create or replace function public.create_incentive(p_exp_ids uuid[], p_net numeric, p_freight numeric, p_pct numeric, p_docs jsonb,
  p_net_usd numeric default null, p_freight_usd numeric default null) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_cnt int; v_sum numeric; v_fob numeric; v_inc numeric; v_id uuid; v_code text; d text; v_file jsonb; v_trade uuid;
  v_types text[] := array['Ka Form','Association Certificate','Forwarding Letter','Overdue Certificate','Undertakings'];
begin
  perform public.require_member();
  if p_exp_ids is null or array_length(p_exp_ids,1) is null then raise exception 'Select at least one collected EXP'; end if;
  select count(*), coalesce(sum(e.amount),0) into v_cnt, v_sum from public.exps e
   where e.id = any(p_exp_ids) and public.exp_collected(e.id) >= e.amount;
  if v_cnt <> array_length(p_exp_ids,1) then raise exception 'Only fully collected EXPs (approved) can be claimed'; end if;
  if exists (select 1 from public.incentive_exps ie join public.incentives i on i.id = ie.incentive_id
             where ie.exp_id = any(p_exp_ids) and i.status in ('pending_approval','approved')) then
    raise exception 'One or more selected EXPs are already in an incentive claim';
  end if;
  if p_net is null or p_net <= 0 then raise exception 'Net proceed must be greater than 0'; end if;
  if p_net > v_sum then raise exception 'Net proceed % cannot be above the EXP amount %', public.fmt_usd(p_net), public.fmt_usd(v_sum); end if;
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
  values (v_sum, round(p_net,2), round(p_freight,2), v_fob, p_pct, v_inc, round(p_net_usd,2), round(p_freight_usd,2), auth.uid())
  returning id, code into v_id, v_code;
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

-- 7. An EXP amount can never drop below what collections already hold on it -------------------------
create or replace function public.trg_exp_min_collected() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_alloc numeric;
begin
  if new.amount is distinct from old.amount then
    v_alloc := public.exp_allocated(new.id);
    if new.amount < v_alloc then
      raise exception 'EXP % has % in collections; its amount cannot go below that', old.code, public.fmt_usd(v_alloc);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists exp_min_collected on public.exps;
create trigger exp_min_collected before update of amount on public.exps
  for each row execute function public.trg_exp_min_collected();

-- 8. PRS document: sort order for uploads, and an empty slot on existing EXP and prepaid collections ---
create or replace function public.add_attachment(p_entity_type text, p_entity_id uuid, p_doc_type text, p_file jsonb) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_sort int;
begin
  if p_file is null or coalesce(p_file->>'path','') = '' then raise exception '% file is required', p_doc_type; end if;
  insert into public.attachments(entity_type, entity_id, doc_type, file_path, file_name, file_size, uploaded_by)
  values (p_entity_type, p_entity_id, p_doc_type, p_file->>'path', coalesce(p_file->>'name','file'), nullif(p_file->>'size','')::bigint, auth.uid())
  returning id into v_id;
  if p_entity_type in ('collection','incentive','trade_amendment') then
    v_sort := coalesce(array_position(case p_entity_type
      when 'collection' then array['Swift Message','Swift Copy','PRC','TT Voucher','PRS']
      when 'incentive' then array['Ka Form','Association Certificate','Forwarding Letter','Overdue Certificate','Undertakings']
      else array['Amendment copy'] end, p_doc_type), 99);
    perform public.doc_put_version(p_entity_type, p_entity_id, p_doc_type, p_file, 'Submitted copy', null, current_date, v_sort);
  end if;
  return v_id;
end $$;

insert into public.documents(entity_type, entity_id, trade_id, doc_type, sort_order, is_demo)
select 'collection', c.id, c.trade_id, 'PRS', 5, coalesce(c.is_demo, false)
from public.collections c
where c.kind in ('exp','prepaid')
  and not exists (select 1 from public.documents d where d.entity_type = 'collection' and d.entity_id = c.id and d.doc_type = 'PRS');

-- 9. Views: collected and outstanding per EXP; prepaid balance per trade ----------------------------
-- collection_status now means: approved = fully collected and approved; pending_approval = fully covered
-- with some part still pending; null = money still outstanding. New columns follow at the end.
create or replace view public.exp_overview with (security_invoker = on) as
select e.id, e.code, e.trade_id, e.shipment_id, e.exp_no, e.awb_no, e.flight_no, e.shipment_date, e.amount, e.amount_usd, e.type, e.status,
  e.created_by, e.is_demo, e.created_at, e.closed_at, t.code as trade_code, t.importer_name, t.status as trade_status,
  (case when cx.collected >= e.amount then 'approved' when cx.allocated >= e.amount then 'pending_approval' end)::public.approval_status as collection_status,
  (select c.code from public.collection_exps ce join public.collections c on c.id = ce.collection_id
    where ce.exp_id = e.id and c.status in ('pending_approval','approved') order by c.created_at desc limit 1) as collection_code,
  (select i.status from public.incentive_exps ie join public.incentives i on i.id = ie.incentive_id
    where ie.exp_id = e.id and i.status in ('pending_approval','approved') order by i.created_at desc limit 1) as incentive_status,
  (select count(*) from public.exp_documents d where d.exp_id = e.id and d.status = 'final')::int as docs_final,
  (select count(*) from public.exp_documents d where d.exp_id = e.id and d.status <> 'missing')::int as docs_uploaded,
  (select count(*) from public.exp_documents d where d.exp_id = e.id)::int as docs_total,
  e.issued_amount, e.issued_amount_usd,
  (select x.id from public.exp_amount_changes x where x.exp_id = e.id and x.status = 'pending_approval' limit 1) as pending_amount_change_id,
  (select count(*) from public.exp_amount_changes x where x.exp_id = e.id and x.status = 'approved')::int as amount_changes,
  e.lc_contract, e.importer, e.exp_serial, e.exp_year, e.entry_date, e.hs_code, e.unit_iso, e.incoterm, e.quantity, e.freight, e.dest_port,
  e.dup_flag, e.dup_date, e.invoice_no, e.invoice_date, e.carrier, e.trans_doc_date, e.custom_code, e.export_bill_no, e.export_bill_date,
  t.sales_contract_no, coalesce(array_length(public.exp_missing(e.*, true), 1), 0) as fields_missing, e.cartons, e.gross_weight,
  cx.collected::numeric(16,2) as collected_amount,
  cx.allocated::numeric(16,2) as allocated_amount,
  greatest(e.amount - cx.allocated, 0)::numeric(16,2) as outstanding_amount
from public.exps e
join public.trades t on t.id = e.trade_id
cross join lateral (
  select coalesce(sum(ce.amount) filter (where c.status = 'approved'), 0) as collected,
         coalesce(sum(ce.amount), 0) as allocated
  from public.collection_exps ce join public.collections c on c.id = ce.collection_id
  where ce.exp_id = e.id and c.status in ('pending_approval','approved')
) cx;

create or replace view public.trade_overview with (security_invoker = on) as
select t.id, t.code, t.exporter, t.exporter_address, t.exporter_phone, t.exporter_email, t.importer_name, t.importer_country, t.buyer_cr_no,
  t.buyer_vat_no, t.buyer_address, t.notify_parties, t.products, t.sales_contract_no, t.contract_date, t.shipping_mark, t.country_of_origin,
  t.country_of_destination, t.expiry_date, t.shipment_timeline, t.carriage_by, t.departure_port, t.point_of_entry, t.payment_type,
  t.payment_terms, t.tolerance_pct, t.bank_name, t.bank_branch, t.bank_routing_no, t.bank_swift, t.bank_account_name, t.bank_account_no,
  t.incentive_terms, t.notes, t.contract_amount, t.contract_amount_usd, t.exchange_rate, t.currency, t.contract_extra, t.status, t.created_by,
  t.approved_by, t.approved_at, t.rejection_reason, t.is_demo, t.created_at, t.updated_at,
  coalesce((select sum(e.amount) from public.exps e where e.trade_id = t.id), 0)::numeric(16,2) as exp_issued,
  (select sum(e.amount_usd) from public.exps e where e.trade_id = t.id)::numeric(14,2) as exp_issued_usd,
  -- money received: EXP and prepaid collections (settlements only move prepaid money onto EXPs)
  coalesce((select sum(c.amount) from public.collections c where c.trade_id = t.id and c.status = 'approved' and c.kind in ('exp','prepaid')), 0)::numeric(16,2) as collected,
  (select sum(c.amount_usd) from public.collections c where c.trade_id = t.id and c.status = 'approved' and c.kind in ('exp','prepaid'))::numeric(14,2) as collected_usd,
  (select count(*) from public.exps e where e.trade_id = t.id)::int as exp_count,
  (select a.id from public.trade_amendments a where a.trade_id = t.id and a.status = 'pending_approval' limit 1) as pending_revision_id,
  (select max(a.amendment_no) from public.trade_amendments a where a.trade_id = t.id and a.status = 'approved') as latest_amendment_no,
  t.company_profile_id, t.buyer_id, t.shipment_deadline,
  exists (select 1 from public.contract_documents d where d.trade_id = t.id and d.status = 'signed') as contract_signed,
  (select count(*) from public.contract_documents d where d.trade_id = t.id)::int as contract_versions,
  coalesce((select array_agg(f.checkpoint order by f.checkpoint) from public.trade_followups f where f.trade_id = t.id), '{}'::int[]) as followups_done,
  coalesce((select sum(c.amount) from public.collections c where c.trade_id = t.id and c.kind = 'prepaid' and c.status = 'approved'), 0)::numeric(16,2) as prepaid_received,
  coalesce((select sum(c.amount) from public.collections c where c.trade_id = t.id and c.kind = 'settlement' and c.status = 'approved'), 0)::numeric(16,2) as prepaid_settled,
  coalesce((select sum(c.amount) from public.collections c where c.trade_id = t.id and c.kind = 'settlement' and c.status = 'pending_approval'), 0)::numeric(16,2) as prepaid_settling
from public.trades t;

grant execute on function public.submit_collection(uuid, numeric, text, boolean, jsonb, jsonb) to authenticated;
grant execute on function public.settle_prepaid(uuid, jsonb) to authenticated;
grant execute on function public.exp_allocated(uuid), public.exp_collected(uuid), public.prepaid_left(uuid) to authenticated;
