-- helpers rules views items
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
