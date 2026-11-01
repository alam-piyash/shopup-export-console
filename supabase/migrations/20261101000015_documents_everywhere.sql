-- One document lifecycle for every module (collections, incentives, amendment copies, EXP amount change backing documents).
-- EXP shipment documents keep exp_documents / exp_document_versions; the sales contract keeps contract_documents.
-- Every upload is a version with a stage, a submitted-on date and a timestamp. Mark final closes a document.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('collection','incentive','trade_amendment','exp_amount_change')),
  entity_id uuid not null,
  trade_id uuid references public.trades(id) on delete cascade,
  doc_type text not null,
  sort_order int not null default 0,
  status text not null default 'missing' check (status in ('missing','uploaded','final')),
  version_count int not null default 0,
  latest_stage text,
  file_path text, file_name text, file_size bigint,
  uploaded_by uuid, uploaded_at timestamptz,
  finalized_by uuid, finalized_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, doc_type)
);
create index documents_entity on public.documents(entity_type, entity_id);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version int not null,
  stage text,
  submitted_on date,
  note text,
  file_path text not null, file_name text not null, file_size bigint,
  uploaded_by uuid, uploaded_at timestamptz not null default now(),
  is_final boolean not null default false,
  is_demo boolean not null default false,
  unique (document_id, version)
);
create index document_versions_doc on public.document_versions(document_id);

do $$
declare t text;
begin
  foreach t in array array['documents','document_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy "Members read" on public.%I for select to authenticated using ((select public.is_member((select auth.uid()))))', t);
  end loop;
end $$;

-- Which trade a document belongs to (for the activity log)
create or replace function public.doc_trade_id(p_entity_type text, p_entity_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case p_entity_type
    when 'collection' then (select trade_id from public.collections where id = p_entity_id)
    when 'incentive' then (select e.trade_id from public.incentive_exps ie join public.exps e on e.id = ie.exp_id where ie.incentive_id = p_entity_id limit 1)
    when 'trade_amendment' then (select trade_id from public.trade_amendments where id = p_entity_id)
    when 'exp_amount_change' then (select trade_id from public.exp_amount_changes where id = p_entity_id)
  end
$$;

-- Internal: create the document if needed and add a version. Not granted to clients.
create or replace function public.doc_put_version(p_entity_type text, p_entity_id uuid, p_doc_type text, p_file jsonb,
  p_stage text, p_note text, p_submitted_on date, p_sort int default 0, p_demo boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_doc public.documents; v_ver int;
begin
  insert into public.documents(entity_type, entity_id, trade_id, doc_type, sort_order, is_demo)
  values (p_entity_type, p_entity_id, public.doc_trade_id(p_entity_type, p_entity_id), p_doc_type, p_sort, p_demo)
  on conflict (entity_type, entity_id, doc_type) do nothing;
  select * into v_doc from public.documents where entity_type = p_entity_type and entity_id = p_entity_id and doc_type = p_doc_type for update;
  if v_doc.status = 'final' then raise exception '% is final. Its lifecycle is closed.', v_doc.doc_type; end if;
  select coalesce(max(version),0) + 1 into v_ver from public.document_versions where document_id = v_doc.id;
  insert into public.document_versions(document_id, version, stage, submitted_on, note, file_path, file_name, file_size, uploaded_by, is_demo)
  values (v_doc.id, v_ver, nullif(trim(p_stage),''), coalesce(p_submitted_on, current_date), nullif(trim(p_note),''),
    p_file->>'path', coalesce(p_file->>'name','file'), nullif(p_file->>'size','')::bigint, auth.uid(), v_doc.is_demo);
  update public.documents set status = 'uploaded', version_count = v_ver, latest_stage = nullif(trim(p_stage),''),
    file_path = p_file->>'path', file_name = coalesce(p_file->>'name','file'), file_size = nullif(p_file->>'size','')::bigint,
    uploaded_by = auth.uid(), uploaded_at = now()
  where id = v_doc.id;
  return v_doc.id;
end $$;
revoke execute on function public.doc_put_version(text, uuid, text, jsonb, text, text, date, int, boolean) from public, anon, authenticated;

-- Files attached at submission (collections, incentives, amendments) also start their document lifecycle
create or replace function public.add_attachment(p_entity_type text, p_entity_id uuid, p_doc_type text, p_file jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sort int;
begin
  if p_file is null or coalesce(p_file->>'path','') = '' then
    raise exception '% file is required', p_doc_type;
  end if;
  insert into public.attachments(entity_type, entity_id, doc_type, file_path, file_name, file_size, uploaded_by)
  values (p_entity_type, p_entity_id, p_doc_type, p_file->>'path', coalesce(p_file->>'name','file'), nullif(p_file->>'size','')::bigint, auth.uid())
  returning id into v_id;
  if p_entity_type in ('collection','incentive','trade_amendment') then
    v_sort := coalesce(array_position(case p_entity_type when 'collection' then array['Swift Copy','PRC','TT Voucher']
      when 'incentive' then array['Ka Form','Association Certificate','Forwarding Letter','Overdue Certificate','Undertakings'] else array['Amendment copy'] end, p_doc_type), 99);
    perform public.doc_put_version(p_entity_type, p_entity_id, p_doc_type, p_file, 'Submitted copy', null, current_date, v_sort);
  end if;
  return v_id;
end $$;

-- EXP amount change backing document starts a lifecycle too
create or replace function public.trg_amount_change_doc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.doc_put_version('exp_amount_change', new.id, 'Backing document',
    jsonb_build_object('path', new.file_path, 'name', new.file_name, 'size', new.file_size), 'Submitted copy', new.reason, current_date, 0, new.is_demo);
  return new;
end $$;
create trigger exp_amount_change_doc after insert on public.exp_amount_changes for each row execute function public.trg_amount_change_doc();

-- Existing attachments become version 1
insert into public.documents(entity_type, entity_id, trade_id, doc_type, sort_order, status, version_count, latest_stage, file_path, file_name, file_size, uploaded_by, uploaded_at, is_demo, created_at)
select a.entity_type, a.entity_id, public.doc_trade_id(a.entity_type, a.entity_id), a.doc_type,
  coalesce(array_position(array['Swift Copy','PRC','TT Voucher','Ka Form','Association Certificate','Forwarding Letter','Overdue Certificate','Undertakings','Amendment copy'], a.doc_type), 99),
  'uploaded', 1, 'Submitted copy', a.file_path, a.file_name, a.file_size, a.uploaded_by, a.created_at, a.is_demo, a.created_at
from public.attachments a
where a.entity_type in ('collection','incentive','trade_amendment')
on conflict (entity_type, entity_id, doc_type) do nothing;
insert into public.document_versions(document_id, version, stage, submitted_on, file_path, file_name, file_size, uploaded_by, uploaded_at, is_demo)
select d.id, 1, 'Submitted copy', d.uploaded_at::date, d.file_path, coalesce(d.file_name,'file'), d.file_size, d.uploaded_by, d.uploaded_at, d.is_demo
from public.documents d where not exists (select 1 from public.document_versions v where v.document_id = d.id) and d.file_path is not null;

-- Client RPCs
create or replace function public.add_document_version(p_doc uuid, p_file jsonb, p_stage text default null, p_note text default null, p_submitted_on date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_doc public.documents; v_code text;
begin
  perform public.require_member();
  select * into v_doc from public.documents where id = p_doc;
  if v_doc.id is null then raise exception 'Document not found'; end if;
  if p_file is null or coalesce(p_file->>'path','') = '' then raise exception 'File is required'; end if;
  perform public.doc_put_version(v_doc.entity_type, v_doc.entity_id, v_doc.doc_type, p_file, p_stage, p_note, p_submitted_on, v_doc.sort_order);
  select code into v_code from public.trades where id = v_doc.trade_id;
  perform public.log_activity(v_doc.entity_type, v_doc.entity_id, v_doc.trade_id, 'document_uploaded',
    jsonb_build_object('code', v_code, 'doc', v_doc.doc_type || ' v' || (v_doc.version_count + 1) || coalesce(' (' || nullif(trim(p_stage),'') || ')', '')));
  return p_doc;
end $$;

create or replace function public.finalize_document(p_doc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_doc public.documents; v_ver int; v_code text;
begin
  perform public.require_member();
  select * into v_doc from public.documents where id = p_doc for update;
  if v_doc.id is null then raise exception 'Document not found'; end if;
  if v_doc.status = 'final' then raise exception '% is already final', v_doc.doc_type; end if;
  select max(version) into v_ver from public.document_versions where document_id = p_doc;
  if v_ver is null then raise exception 'Upload % before marking it final', v_doc.doc_type; end if;
  update public.document_versions set is_final = (version = v_ver) where document_id = p_doc;
  update public.documents set status = 'final', finalized_by = auth.uid(), finalized_at = now() where id = p_doc;
  select code into v_code from public.trades where id = v_doc.trade_id;
  perform public.log_activity(v_doc.entity_type, v_doc.entity_id, v_doc.trade_id, 'document_final',
    jsonb_build_object('code', v_code, 'doc', v_doc.doc_type || ' v' || v_ver));
end $$;

-- Sales contract versions get a stage and a submitted-on date
alter table public.contract_documents add column stage text, add column submitted_on date;
update public.contract_documents set stage = case when source = 'generated' then 'Generated draft' when status = 'signed' then 'Signed copy' else 'Uploaded copy' end,
  submitted_on = created_at::date where stage is null;

drop function if exists public.add_contract_version(uuid, jsonb, text, text);
create or replace function public.add_contract_version(p_trade uuid, p_file jsonb, p_source text, p_note text default null, p_stage text default null, p_submitted_on date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_t public.trades; v_ver int; v_id uuid;
begin
  perform public.require_member();
  select * into v_t from public.trades where id = p_trade;
  if v_t.id is null then raise exception 'Trade not found'; end if;
  if p_source not in ('generated','uploaded') then raise exception 'Unknown document source'; end if;
  if p_file is null or coalesce(p_file->>'path','') = '' then raise exception 'File is required'; end if;
  select coalesce(max(version),0) + 1 into v_ver from public.contract_documents where trade_id = p_trade;
  insert into public.contract_documents(trade_id, version, source, file_path, file_name, file_size, note, uploaded_by, is_demo, stage, submitted_on)
  values (p_trade, v_ver, p_source, p_file->>'path', coalesce(p_file->>'name','sales-contract.pdf'), nullif(p_file->>'size','')::bigint,
    nullif(trim(p_note),''), auth.uid(), v_t.is_demo,
    coalesce(nullif(trim(p_stage),''), case when p_source = 'generated' then 'Generated draft' else 'Uploaded copy' end), coalesce(p_submitted_on, current_date))
  returning id into v_id;
  perform public.log_activity('trade', p_trade, p_trade, case when p_source = 'generated' then 'contract_generated' else 'contract_uploaded' end,
    jsonb_build_object('code', v_t.code, 'version', v_ver));
  return v_id;
end $$;

-- create_trade inserts version 1 directly; give it a stage too
create or replace function public.trg_contract_doc_stage() returns trigger
language plpgsql set search_path = public as $$
begin
  new.stage := coalesce(new.stage, case when new.source = 'generated' then 'Generated draft' else 'Uploaded copy' end);
  new.submitted_on := coalesce(new.submitted_on, current_date);
  return new;
end $$;
create trigger contract_doc_stage before insert on public.contract_documents for each row execute function public.trg_contract_doc_stage();

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('add_document_version','finalize_document','add_contract_version') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke execute on function public.add_attachment(text, uuid, text, jsonb) from public, anon;
revoke execute on function public.doc_trade_id(text, uuid) from public, anon;
