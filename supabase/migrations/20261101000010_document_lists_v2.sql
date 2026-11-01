-- Document lists v2 (agreed with finance):
--   EXP (shipment): EXP Form, Commercial Invoice, Packing List, Airway Bill, Bill of Export, VAT Document, Phytosanitary Certificate, Mushak 6.3
--   Collection:     Swift Copy, PRC, TT Voucher
--   Incentive:      Ka Form, Association Certificate, Forwarding Letter, Overdue Certificate, Undertakings
-- The sales contract stays on the trade (required when the trade is created).

create or replace function public.exp_doc_types() returns text[]
language sql immutable as $$
  select array['EXP Form','Commercial Invoice','Packing List','Airway Bill','Bill of Export','VAT Document','Phytosanitary Certificate','Mushak 6.3']
$$;

-- New EXPs get the new list
create or replace function public.trg_exp_create_docs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.exp_documents(exp_id, doc_type, sort_order, is_demo)
  select new.id, d.name, d.ord, new.is_demo from unnest(public.exp_doc_types()) with ordinality as d(name, ord);
  return new;
end $$;

-- Auto close when every document of the EXP is final (no fixed count)
create or replace function public.trg_exp_autoclose() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_exp public.exps;
begin
  if not exists (select 1 from public.exp_documents where exp_id = new.exp_id and status <> 'final') then
    update public.exps set status = 'closed', closed_at = now() where id = new.exp_id and status = 'open' returning * into v_exp;
    if v_exp.id is not null then
      perform public.log_activity('exp', v_exp.id, v_exp.trade_id, 'exp_closed', jsonb_build_object('code', v_exp.code));
    end if;
  end if;
  return null;
end $$;

-- Existing EXPs: keep every uploaded file, map to the new names, add the new slots as missing
update public.exp_documents set doc_type = 'VAT Document' where doc_type = 'Asycuda VAT Certificate';
insert into public.exp_documents(exp_id, doc_type, sort_order, status, file_path, file_name, file_size, uploaded_by, uploaded_at, finalized_by, finalized_at, is_demo)
select exp_id, 'Packing List', 0, status, file_path, file_name, file_size, uploaded_by, uploaded_at, finalized_by, finalized_at, is_demo
from public.exp_documents d where d.doc_type = 'Commercial Invoice and Packing List'
  and not exists (select 1 from public.exp_documents x where x.exp_id = d.exp_id and x.doc_type = 'Packing List');
update public.exp_documents set doc_type = 'Commercial Invoice' where doc_type = 'Commercial Invoice and Packing List';
insert into public.exp_documents(exp_id, doc_type, sort_order, is_demo)
select e.id, t.name, 0, e.is_demo from public.exps e cross join unnest(public.exp_doc_types()) as t(name)
where not exists (select 1 from public.exp_documents x where x.exp_id = e.id and x.doc_type = t.name);
update public.exp_documents d set sort_order = o.ord
from unnest(public.exp_doc_types()) with ordinality as o(name, ord) where d.doc_type = o.name;

-- Overview: expose the document total so the app never assumes a fixed number
create or replace view public.exp_overview with (security_invoker = true) as
 SELECT e.id, e.code, e.trade_id, e.shipment_id, e.exp_no, e.awb_no, e.flight_no, e.shipment_date, e.amount, e.amount_usd,
    e.type, e.status, e.created_by, e.is_demo, e.created_at, e.closed_at,
    t.code AS trade_code, t.importer_name, t.status AS trade_status,
    ( SELECT c.status FROM collection_exps ce JOIN collections c ON c.id = ce.collection_id
       WHERE ce.exp_id = e.id AND (c.status = ANY (ARRAY['pending_approval'::approval_status, 'approved'::approval_status]))
       ORDER BY c.created_at DESC LIMIT 1) AS collection_status,
    ( SELECT c.code FROM collection_exps ce JOIN collections c ON c.id = ce.collection_id
       WHERE ce.exp_id = e.id AND (c.status = ANY (ARRAY['pending_approval'::approval_status, 'approved'::approval_status]))
       ORDER BY c.created_at DESC LIMIT 1) AS collection_code,
    ( SELECT i.status FROM incentive_exps ie JOIN incentives i ON i.id = ie.incentive_id
       WHERE ie.exp_id = e.id AND (i.status = ANY (ARRAY['pending_approval'::approval_status, 'approved'::approval_status]))
       ORDER BY i.created_at DESC LIMIT 1) AS incentive_status,
    (( SELECT count(*) FROM exp_documents d WHERE d.exp_id = e.id AND d.status = 'final'::doc_status))::integer AS docs_final,
    (( SELECT count(*) FROM exp_documents d WHERE d.exp_id = e.id AND d.status <> 'missing'::doc_status))::integer AS docs_uploaded,
    (( SELECT count(*) FROM exp_documents d WHERE d.exp_id = e.id))::integer AS docs_total
   FROM exps e JOIN trades t ON t.id = e.trade_id;

-- Collection documents
create or replace function public.create_collection(p_trade uuid, p_amount numeric, p_bank_ref text, p_exp_ids uuid[], p_docs jsonb, p_amount_usd numeric DEFAULT NULL::numeric)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_t public.trades; v_sum numeric; v_cnt int; v_id uuid; v_code text; d text; v_file jsonb;
  v_types text[] := array['Swift Copy','PRC','TT Voucher'];
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
  foreach d in array v_types loop
    select x into v_file from jsonb_array_elements(coalesce(p_docs,'[]'::jsonb)) x where x->>'doc_type' = d limit 1;
    if v_file is null or coalesce(v_file->>'path','') = '' then raise exception '% is required', d; end if;
  end loop;
  insert into public.collections(trade_id, amount, amount_usd, bank_reference, created_by)
  values (p_trade, round(p_amount,2), round(p_amount_usd,2), nullif(trim(p_bank_ref),''), auth.uid()) returning id, code into v_id, v_code;
  insert into public.collection_exps(collection_id, exp_id, amount) select v_id, id, amount from public.exps where id = any(p_exp_ids);
  foreach d in array v_types loop
    select x into v_file from jsonb_array_elements(p_docs) x where x->>'doc_type' = d limit 1;
    perform public.add_attachment('collection', v_id, d, v_file);
  end loop;
  perform public.log_activity('collection', v_id, p_trade, 'collection_created', jsonb_build_object('code', v_code, 'amount', p_amount));
  return v_id;
end $function$;

-- Incentive documents
create or replace function public.create_incentive(p_exp_ids uuid[], p_net numeric, p_freight numeric, p_pct numeric, p_docs jsonb, p_net_usd numeric DEFAULT NULL::numeric, p_freight_usd numeric DEFAULT NULL::numeric)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_cnt int; v_sum numeric; v_fob numeric; v_inc numeric; v_id uuid; v_code text; d text; v_file jsonb; v_trade uuid;
  v_types text[] := array['Ka Form','Association Certificate','Forwarding Letter','Overdue Certificate','Undertakings'];
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
end $function$;

