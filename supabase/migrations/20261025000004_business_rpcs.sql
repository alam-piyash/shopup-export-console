-- business rpcs
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
