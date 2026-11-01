-- EXP document lifecycle with versions.
-- Each upload is kept as a new version with its own timestamp and stage (for example: submitted copy, signed copy,
-- copy signed by both parties and Bangladesh Bank). Nothing is replaced. Mark final closes the lifecycle.
-- exp_documents keeps a pointer to the latest version so existing screens and counts keep working.

create table public.exp_document_versions (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.exp_documents(id) on delete cascade,
  exp_id uuid not null references public.exps(id) on delete cascade,
  version int not null,
  stage text,
  submitted_on date,
  note text,
  file_path text not null, file_name text not null, file_size bigint,
  uploaded_by uuid, uploaded_at timestamptz not null default now(),
  is_final boolean not null default false,
  is_demo boolean not null default false,
  unique (doc_id, version)
);
create index exp_document_versions_doc on public.exp_document_versions(doc_id);
alter table public.exp_document_versions enable row level security;
grant select on public.exp_document_versions to authenticated;
grant all on public.exp_document_versions to service_role;
create policy "Members read" on public.exp_document_versions for select to authenticated using ((select public.is_member((select auth.uid()))));

alter table public.exp_documents add column version_count int not null default 0, add column latest_stage text;

-- Existing uploads become version 1
insert into public.exp_document_versions(doc_id, exp_id, version, stage, submitted_on, file_path, file_name, file_size, uploaded_by, uploaded_at, is_final, is_demo)
select d.id, d.exp_id, 1, null, coalesce(d.uploaded_at, now())::date, d.file_path, coalesce(d.file_name, 'file'), d.file_size, d.uploaded_by, coalesce(d.uploaded_at, now()), d.status = 'final', d.is_demo
from public.exp_documents d where d.file_path is not null;
update public.exp_documents d set version_count = 1 where d.file_path is not null;

drop function if exists public.upload_exp_document(uuid, jsonb);
create or replace function public.upload_exp_document(p_doc uuid, p_file jsonb, p_stage text default null, p_note text default null, p_submitted_on date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_d public.exp_documents; v_e public.exps; v_ver int; v_id uuid;
begin
  perform public.require_member();
  select * into v_d from public.exp_documents where id = p_doc for update;
  if v_d.id is null then raise exception 'Document not found'; end if;
  select * into v_e from public.exps where id = v_d.exp_id;
  if v_d.status = 'final' then raise exception '% is final. Its lifecycle is closed.', v_d.doc_type; end if;
  if v_e.shipment_id is null then raise exception 'Add the shipment ID to this EXP before uploading documents'; end if;
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
end $$;

create or replace function public.finalize_exp_document(p_doc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_d public.exp_documents; v_e public.exps; v_ver int;
begin
  perform public.require_member();
  select * into v_d from public.exp_documents where id = p_doc for update;
  if v_d.id is null then raise exception 'Document not found'; end if;
  if v_d.status = 'final' then raise exception '% is already final', v_d.doc_type; end if;
  select max(version) into v_ver from public.exp_document_versions where doc_id = p_doc;
  if v_ver is null then raise exception 'Upload % before marking it final', v_d.doc_type; end if;
  update public.exp_document_versions set is_final = (version = v_ver) where doc_id = p_doc;
  select * into v_e from public.exps where id = v_d.exp_id;
  update public.exp_documents set status = 'final', finalized_by = auth.uid(), finalized_at = now() where id = p_doc;
  perform public.log_activity('exp_document', p_doc, v_e.trade_id, 'document_final',
    jsonb_build_object('code', v_e.code, 'doc', v_d.doc_type || ' v' || v_ver));
end $$;

revoke execute on function public.upload_exp_document(uuid, jsonb, text, text, date) from public, anon;
grant execute on function public.upload_exp_document(uuid, jsonb, text, text, date) to authenticated;
revoke execute on function public.finalize_exp_document(uuid) from public, anon;
grant execute on function public.finalize_exp_document(uuid) to authenticated;
