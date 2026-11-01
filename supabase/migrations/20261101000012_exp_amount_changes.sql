-- EXP amount changes: the EXP is issued with one amount, the shipment can end up different.
-- Keep the issued (EXP form) amount, and change the working amount through a request with a reason and a backing document.
-- An admin approves. Works on open and closed EXPs. All totals use exps.amount (the latest approved amount).

alter table public.exps
  add column issued_amount numeric(16,2),
  add column issued_amount_usd numeric(14,2);
update public.exps set issued_amount = amount, issued_amount_usd = amount_usd where issued_amount is null;
set constraints all immediate;
alter table public.exps alter column issued_amount set not null;

create table public.exp_amount_changes (
  id uuid primary key default gen_random_uuid(),
  exp_id uuid not null references public.exps(id) on delete cascade,
  trade_id uuid not null references public.trades(id) on delete cascade,
  old_amount numeric(16,2) not null,
  new_amount numeric(16,2) not null check (new_amount > 0),
  old_amount_usd numeric(14,2),
  new_amount_usd numeric(14,2),
  reason text not null,
  file_path text not null, file_name text not null, file_size bigint,
  status public.approval_status not null default 'pending_approval',
  requested_by uuid, created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz, rejection_reason text,
  is_demo boolean not null default false
);
create index exp_amount_changes_exp on public.exp_amount_changes(exp_id);
create unique index exp_amount_changes_one_pending on public.exp_amount_changes(exp_id) where status = 'pending_approval';
alter table public.exp_amount_changes enable row level security;
grant select on public.exp_amount_changes to authenticated;
grant all on public.exp_amount_changes to service_role;
create policy "Members read" on public.exp_amount_changes for select to authenticated using ((select public.is_member((select auth.uid()))));

-- New EXPs record their issued amount
create or replace function public.trg_exp_issued() returns trigger
language plpgsql set search_path = public as $$
begin
  new.issued_amount := coalesce(new.issued_amount, new.amount);
  new.issued_amount_usd := coalesce(new.issued_amount_usd, new.amount_usd);
  return new;
end $$;
create trigger exp_issued before insert on public.exps for each row execute function public.trg_exp_issued();

-- Closed EXPs keep their amount locked, except through an approved amount change
create or replace function public.trg_exp_lock() returns trigger
language plpgsql as $$
begin
  if old.status = 'closed' and new.amount is distinct from old.amount
     and coalesce(current_setting('app.exp_amount_change', true), '') <> 'on' then
    raise exception 'EXP % is closed, its amount is locked', old.code;
  end if;
  return new;
end $$;

-- Total EXP value may reach the contract amount plus the contract tolerance (actual shipments vary)
create or replace function public.check_trade_exp_total(p_trade uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_contract numeric; v_tol numeric; v_code text; v_limit numeric;
begin
  select contract_amount, coalesce(tolerance_pct, 0), code into v_contract, v_tol, v_code from public.trades where id = p_trade;
  if v_contract is null then return; end if;
  v_limit := round(v_contract * (1 + v_tol / 100), 2);
  select coalesce(sum(amount),0) into v_total from public.exps where trade_id = p_trade;
  if v_total > v_limit then
    raise exception 'EXP total % exceeds the contract amount % (with % tolerance) for %', public.fmt_bdt(v_total), public.fmt_bdt(v_limit), v_tol || '%', v_code;
  end if;
end $$;

-- Direct edits no longer change the amount; amounts change through requests
create or replace function public.update_exp(p_id uuid, p_amount numeric, p_fields jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_e public.exps; v_ship text := nullif(trim(p_fields->>'shipment_id'),'');
begin
  perform public.require_member();
  select * into v_e from public.exps where id = p_id;
  if v_e.id is null then raise exception 'EXP not found'; end if;
  if p_amount is not null and round(p_amount,2) <> v_e.amount then
    raise exception 'Use Change amount on % to update the amount with a reason and document', v_e.code;
  end if;
  if v_e.type = 'regular' and v_ship is null then raise exception 'Shipment ID is required for regular EXPs'; end if;
  update public.exps set shipment_id = v_ship,
    exp_no = nullif(trim(p_fields->>'exp_no'),''), awb_no = nullif(trim(p_fields->>'awb_no'),''),
    flight_no = nullif(trim(p_fields->>'flight_no'),''), shipment_date = nullif(p_fields->>'shipment_date','')::date
  where id = p_id;
  perform public.log_activity('exp', p_id, v_e.trade_id, 'exp_updated', jsonb_build_object('code', v_e.code));
end $$;

create or replace function public.request_exp_amount_change(p_exp uuid, p_amount numeric, p_amount_usd numeric, p_reason text, p_file jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_e public.exps; v_t public.trades; v_id uuid; v_total numeric; v_limit numeric;
begin
  perform public.require_member();
  select * into v_e from public.exps where id = p_exp;
  if v_e.id is null then raise exception 'EXP not found'; end if;
  select * into v_t from public.trades where id = v_e.trade_id;
  if v_t.status not in ('active','closed') then raise exception 'Amounts can change only on active or closed trades (no pending amendment)'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  if p_file is null or coalesce(p_file->>'path','') = '' then raise exception 'A backing document is required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'New amount must be greater than 0'; end if;
  if round(p_amount,2) = v_e.amount and round(p_amount_usd,2) is not distinct from v_e.amount_usd then raise exception 'The new amount is the same as the current amount'; end if;
  if exists (select 1 from public.exp_amount_changes where exp_id = p_exp and status = 'pending_approval') then
    raise exception 'An amount change for % is already awaiting approval', v_e.code;
  end if;
  select coalesce(sum(amount),0) - v_e.amount + round(p_amount,2) into v_total from public.exps where trade_id = v_e.trade_id;
  v_limit := round(v_t.contract_amount * (1 + coalesce(v_t.tolerance_pct,0) / 100), 2);
  if v_total > v_limit then
    raise exception 'EXP total would be %, above the contract limit % (contract plus % tolerance). Amend the contract first.', public.fmt_bdt(v_total), public.fmt_bdt(v_limit), coalesce(v_t.tolerance_pct,0) || '%';
  end if;
  insert into public.exp_amount_changes(exp_id, trade_id, old_amount, new_amount, old_amount_usd, new_amount_usd, reason, file_path, file_name, file_size, requested_by, is_demo)
  values (p_exp, v_e.trade_id, v_e.amount, round(p_amount,2), v_e.amount_usd, round(p_amount_usd,2), trim(p_reason),
    p_file->>'path', coalesce(p_file->>'name','document'), nullif(p_file->>'size','')::bigint, auth.uid(), v_e.is_demo)
  returning id into v_id;
  perform public.log_activity('exp', p_exp, v_e.trade_id, 'exp_amount_requested',
    jsonb_build_object('code', v_e.code, 'old_amount', v_e.amount, 'new_amount', round(p_amount,2), 'reason', trim(p_reason)));
  return v_id;
end $$;

create or replace function public.decide_exp_amount_change(p_id uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_c public.exp_amount_changes; v_e public.exps; v_t public.trades;
begin
  perform public.require_admin();
  select * into v_c from public.exp_amount_changes where id = p_id for update;
  if v_c.id is null or v_c.status <> 'pending_approval' then raise exception 'This amount change is not awaiting approval'; end if;
  select * into v_e from public.exps where id = v_c.exp_id for update;
  if not p_approve then
    if coalesce(trim(p_reason),'') = '' then raise exception 'A rejection reason is required'; end if;
    update public.exp_amount_changes set status = 'rejected', approved_by = auth.uid(), approved_at = now(), rejection_reason = trim(p_reason) where id = p_id;
    perform public.log_activity('exp', v_e.id, v_e.trade_id, 'exp_amount_rejected', jsonb_build_object('code', v_e.code, 'reason', trim(p_reason)));
    return;
  end if;
  select * into v_t from public.trades where id = v_e.trade_id;
  if v_t.status = 'revision_pending' then raise exception 'A contract amendment is pending on %. Decide it first.', v_t.code; end if;
  if v_e.amount <> v_c.old_amount then raise exception 'The EXP amount changed since this request. Ask for a new request.'; end if;
  perform set_config('app.exp_amount_change', 'on', true);
  update public.exps set amount = v_c.new_amount, amount_usd = coalesce(v_c.new_amount_usd, amount_usd) where id = v_e.id;
  perform set_config('app.exp_amount_change', 'off', true);
  update public.exp_amount_changes set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform public.check_trade_exp_total(v_e.trade_id);
  perform public.log_activity('exp', v_e.id, v_e.trade_id, 'exp_amount_approved',
    jsonb_build_object('code', v_e.code, 'old_amount', v_c.old_amount, 'new_amount', v_c.new_amount));
end $$;

create or replace function public.withdraw_exp_amount_change(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_c public.exp_amount_changes; v_code text;
begin
  perform public.require_member();
  select * into v_c from public.exp_amount_changes where id = p_id for update;
  if v_c.id is null or v_c.status <> 'pending_approval' then raise exception 'This amount change is not awaiting approval'; end if;
  if v_c.requested_by is distinct from auth.uid() and not public.has_role(auth.uid(), 'admin') then raise exception 'Only the requester or an admin can withdraw it'; end if;
  update public.exp_amount_changes set status = 'withdrawn' where id = p_id;
  select code into v_code from public.exps where id = v_c.exp_id;
  perform public.log_activity('exp', v_c.exp_id, v_c.trade_id, 'exp_amount_withdrawn', jsonb_build_object('code', v_code));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('update_exp','request_exp_amount_change','decide_exp_amount_change','withdraw_exp_amount_change') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

create or replace function public.pending_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_member();
  return jsonb_build_object(
    'trades', (select count(*) from public.trades where status in ('pending_approval','revision_pending')),
    'collections', (select count(*) from public.collections where status = 'pending_approval'),
    'incentives', (select count(*) from public.incentives where status = 'pending_approval'),
    'exp_amounts', (select count(*) from public.exp_amount_changes where status = 'pending_approval'));
end $$;

-- Demo cleanup covers the new table
create or replace function public.remove_demo_data() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform public.require_admin();
  v_n := public.demo_count();
  delete from public.exp_amount_changes where is_demo or exp_id in (select id from public.exps where is_demo);
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

-- Overview gains issued amounts and the pending change
create or replace view public.exp_overview with (security_invoker = true) as
 SELECT e.id, e.code, e.trade_id, e.shipment_id, e.exp_no, e.awb_no, e.flight_no, e.shipment_date, e.amount, e.amount_usd, e.type, e.status,
    e.created_by, e.is_demo, e.created_at, e.closed_at,
    t.code AS trade_code, t.importer_name, t.status AS trade_status,
    ( SELECT c.status FROM collection_exps ce JOIN collections c ON c.id = ce.collection_id
       WHERE ce.exp_id = e.id AND c.status = ANY (ARRAY['pending_approval'::approval_status, 'approved'::approval_status]) ORDER BY c.created_at DESC LIMIT 1) AS collection_status,
    ( SELECT c.code FROM collection_exps ce JOIN collections c ON c.id = ce.collection_id
       WHERE ce.exp_id = e.id AND c.status = ANY (ARRAY['pending_approval'::approval_status, 'approved'::approval_status]) ORDER BY c.created_at DESC LIMIT 1) AS collection_code,
    ( SELECT i.status FROM incentive_exps ie JOIN incentives i ON i.id = ie.incentive_id
       WHERE ie.exp_id = e.id AND i.status = ANY (ARRAY['pending_approval'::approval_status, 'approved'::approval_status]) ORDER BY i.created_at DESC LIMIT 1) AS incentive_status,
    (( SELECT count(*) FROM exp_documents d WHERE d.exp_id = e.id AND d.status = 'final'::doc_status))::integer AS docs_final,
    (( SELECT count(*) FROM exp_documents d WHERE d.exp_id = e.id AND d.status <> 'missing'::doc_status))::integer AS docs_uploaded,
    (( SELECT count(*) FROM exp_documents d WHERE d.exp_id = e.id))::integer AS docs_total,
    e.issued_amount, e.issued_amount_usd,
    ( SELECT x.id FROM exp_amount_changes x WHERE x.exp_id = e.id AND x.status = 'pending_approval' LIMIT 1) AS pending_amount_change_id,
    (( SELECT count(*) FROM exp_amount_changes x WHERE x.exp_id = e.id AND x.status = 'approved'))::integer AS amount_changes
   FROM exps e JOIN trades t ON t.id = e.trade_id;
