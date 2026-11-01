-- Company profile logo, printed at the top of generated sales contracts.
alter table public.company_profiles add column logo_path text, add column logo_name text;

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
      bank_name, bank_branch, bank_routing_no, bank_swift, bank_account_name, bank_account_no, shipping_mark, sc_prefix, default_terms, is_default, is_active, created_by, logo_path, logo_name)
    values (trim(p->>'label'), trim(p->>'legal_name'), nullif(trim(p->>'address'),''), nullif(trim(p->>'phone'),''), nullif(trim(p->>'email'),''),
      nullif(trim(p->>'signatory_name'),''), nullif(trim(p->>'signatory_designation'),''),
      nullif(trim(p->>'bank_name'),''), nullif(trim(p->>'bank_branch'),''), nullif(trim(p->>'bank_routing_no'),''), nullif(trim(p->>'bank_swift'),''),
      nullif(trim(p->>'bank_account_name'),''), nullif(trim(p->>'bank_account_no'),''), nullif(trim(p->>'shipping_mark'),''), nullif(trim(p->>'sc_prefix'),''),
      coalesce(p->'default_terms','{}'::jsonb), v_default or not exists (select 1 from public.company_profiles where is_default), coalesce((p->>'is_active')::boolean, true), auth.uid(),
      nullif(p->>'logo_path',''), nullif(p->>'logo_name',''))
    returning id into v_id;
  else
    update public.company_profiles set label = trim(p->>'label'), legal_name = trim(p->>'legal_name'), address = nullif(trim(p->>'address'),''),
      phone = nullif(trim(p->>'phone'),''), email = nullif(trim(p->>'email'),''), signatory_name = nullif(trim(p->>'signatory_name'),''),
      signatory_designation = nullif(trim(p->>'signatory_designation'),''), bank_name = nullif(trim(p->>'bank_name'),''), bank_branch = nullif(trim(p->>'bank_branch'),''),
      bank_routing_no = nullif(trim(p->>'bank_routing_no'),''), bank_swift = nullif(trim(p->>'bank_swift'),''), bank_account_name = nullif(trim(p->>'bank_account_name'),''),
      bank_account_no = nullif(trim(p->>'bank_account_no'),''), shipping_mark = nullif(trim(p->>'shipping_mark'),''), sc_prefix = nullif(trim(p->>'sc_prefix'),''),
      default_terms = coalesce(p->'default_terms', default_terms), is_default = v_default,
      logo_path = case when p ? 'logo_path' then nullif(p->>'logo_path','') else logo_path end,
      logo_name = case when p ? 'logo_path' then nullif(p->>'logo_name','') else logo_name end,
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

revoke execute on function public.save_company_profile(jsonb) from public, anon;
grant execute on function public.save_company_profile(jsonb) to authenticated;
