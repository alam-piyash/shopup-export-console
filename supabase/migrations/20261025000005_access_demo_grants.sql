-- access demo grants
-- ===== Access control RPCs =====
create or replace function public.admin_count() returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.user_roles where role = 'admin'
$$;

create or replace function public.set_user_role(p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = public as $$
declare v_old public.app_role;
begin
  perform public.require_admin();
  select role into v_old from public.user_roles where user_id = p_user;
  if v_old = 'admin' and p_role <> 'admin' and public.admin_count() <= 1 then
    raise exception 'There must be at least one admin';
  end if;
  insert into public.user_roles(user_id, role) values (p_user, p_role)
  on conflict (user_id) do update set role = excluded.role;
  perform public.log_activity('user', p_user, null, 'role_changed', jsonb_build_object('from', v_old, 'to', p_role));
end $$;

create or replace function public.remove_access(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_old public.app_role;
begin
  perform public.require_admin();
  select role into v_old from public.user_roles where user_id = p_user;
  if v_old = 'admin' and public.admin_count() <= 1 then raise exception 'You cannot remove the last admin'; end if;
  delete from public.user_roles where user_id = p_user;
  perform public.log_activity('user', p_user, null, 'access_removed', jsonb_build_object('role', v_old));
end $$;

create or replace function public.preassign_role(p_email text, p_name text, p_role public.app_role) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); v_uid uuid;
begin
  perform public.require_admin();
  if v_email !~ ('^[^@\s]+@' || replace(public.allowed_domain(), '.', '\.') || '$') then
    raise exception 'Email must be a % address', public.allowed_domain();
  end if;
  select id into v_uid from public.profiles where email = v_email;
  if v_uid is not null then
    perform public.set_user_role(v_uid, p_role);
    return;
  end if;
  insert into public.role_preassignments(email, full_name, role, created_by) values (v_email, nullif(trim(p_name),''), p_role, auth.uid())
  on conflict (email) do update set full_name = excluded.full_name, role = excluded.role;
end $$;

create or replace function public.delete_preassignment(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  delete from public.role_preassignments where email = lower(trim(p_email));
end $$;

-- ===== Demo data helpers =====
create or replace function public.demo_count() returns int
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_member();
  return (select count(*) from public.trades where is_demo) + (select count(*) from public.exps where is_demo)
    + (select count(*) from public.collections where is_demo) + (select count(*) from public.incentives where is_demo)
    + (select count(*) from public.trade_amendments where is_demo);
end $$;

create or replace function public.remove_demo_data() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform public.require_admin();
  v_n := public.demo_count();
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

-- ===== Lock down RPC execution to signed-in users =====
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'create_trade','approve_trade','reject_trade','close_trade','create_exp','update_exp','upload_exp_document','finalize_exp_document',
             'request_amendment','approve_amendment','reject_amendment','withdraw_amendment','create_collection','decide_collection',
             'create_incentive','decide_incentive','pending_counts','set_user_role','remove_access','preassign_role','delete_preassignment',
             'demo_count','remove_demo_data') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
