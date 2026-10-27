-- Allow more than one Google Workspace email domain (comma separated in app_settings.allowed_domain).
create or replace function public.allowed_domains() returns text[]
language sql stable security definer set search_path = public as $$
  select array(select lower(trim(d)) from unnest(string_to_array((select allowed_domain from public.app_settings where id = 1), ',')) d where trim(d) <> '')
$$;

create or replace function public.is_allowed_email(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_email is not null
    and lower(trim(p_email)) ~ '^[^@\s]+@[^@\s]+$'
    and split_part(lower(trim(p_email)), '@', 2) = any (public.allowed_domains())
$$;

create or replace function public.allowed_domains_label() returns text
language sql stable security definer set search_path = public as $$
  select array_to_string(public.allowed_domains(), ' or ')
$$;

create or replace function public.is_member(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id)
    and exists (select 1 from public.profiles where id = _user_id and public.is_allowed_email(email))
$$;

create or replace function public.enforce_domain() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_allowed_email(new.email) then
    raise exception 'Only % accounts can sign in to ShopUp Export Console', public.allowed_domains_label();
  end if;
  return new;
end $$;

create or replace function public.preassign_role(p_email text, p_name text, p_role public.app_role) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); v_uid uuid;
begin
  perform public.require_admin();
  if not public.is_allowed_email(v_email) then
    raise exception 'Email must be a % address', public.allowed_domains_label();
  end if;
  select id into v_uid from public.profiles where email = v_email;
  if v_uid is not null then
    perform public.set_user_role(v_uid, p_role);
    return;
  end if;
  insert into public.role_preassignments(email, full_name, role, created_by) values (v_email, nullif(trim(p_name),''), p_role, auth.uid())
  on conflict (email) do update set full_name = excluded.full_name, role = excluded.role;
end $$;

revoke execute on function public.preassign_role(text, text, public.app_role) from public, anon;
grant execute on function public.preassign_role(text, text, public.app_role) to authenticated;

update public.app_settings set allowed_domain = 'shopup.org,silq.net' where id = 1;
