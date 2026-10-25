-- types settings profiles auth
-- ===== Types =====
create type public.app_role as enum ('operation','admin');
create type public.trade_status as enum ('pending_approval','active','revision_pending','closed','rejected');
create type public.approval_status as enum ('pending_approval','approved','rejected','withdrawn');
create type public.exp_type as enum ('regular','advance');
create type public.exp_status as enum ('open','closed');
create type public.doc_status as enum ('missing','uploaded','final');

-- ===== App settings (allowed domain, bootstrap admin) =====
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  allowed_domain text not null default 'shopup.org',
  bootstrap_admin_email text not null default 'tasnim.piyash@shopup.org'
);
insert into public.app_settings default values;
alter table public.app_settings enable row level security;
grant select on public.app_settings to authenticated, anon;
create policy "Anyone reads settings" on public.app_settings for select using (true);

create or replace function public.allowed_domain() returns text
language sql stable security definer set search_path = public as $$
  select lower(allowed_domain) from public.app_settings where id = 1
$$;

-- ===== Profiles & roles =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now()
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create table public.role_preassignments (
  email text primary key,
  full_name text,
  role public.app_role not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select on public.role_preassignments to authenticated;
grant all on public.role_preassignments to service_role;
alter table public.role_preassignments enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_member(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id)
    and exists (select 1 from public.profiles where id = _user_id and lower(email) like '%@' || public.allowed_domain())
$$;

create or replace function public.require_member() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_member(auth.uid()) then
    raise exception 'You do not have access to ShopUp Export Console';
  end if;
end $$;

create or replace function public.require_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can do this';
  end if;
end $$;

create policy "Members read profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_member(auth.uid()));
create policy "Read own role or admin reads all" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "Admins read preassignments" on public.role_preassignments for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ===== Auth triggers =====
create or replace function public.enforce_domain() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or lower(new.email) not like '%@' || public.allowed_domain() then
    raise exception 'Only % accounts can sign in to ShopUp Export Console', public.allowed_domain();
  end if;
  return new;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pre public.role_preassignments; v_role public.app_role := 'operation'; v_boot text;
begin
  select lower(bootstrap_admin_email) into v_boot from public.app_settings where id = 1;
  select * into v_pre from public.role_preassignments where lower(email) = lower(new.email);
  insert into public.profiles (id, email, full_name, avatar_url, last_sign_in_at)
  values (new.id, lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', v_pre.full_name),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    new.last_sign_in_at)
  on conflict (id) do nothing;
  if lower(new.email) = v_boot or not exists (select 1 from public.user_roles where role = 'admin') then
    v_role := 'admin';  -- bootstrap admin, or the very first person to sign in
  elsif v_pre.email is not null then
    v_role := v_pre.role;
  end if;
  insert into public.user_roles (user_id, role) values (new.id, v_role) on conflict (user_id) do nothing;
  delete from public.role_preassignments where lower(email) = lower(new.email);
  return new;
end $$;

create or replace function public.handle_user_sign_in() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set
    last_sign_in_at = new.last_sign_in_at,
    full_name = coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', full_name),
    avatar_url = coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', avatar_url)
  where id = new.id;
  return new;
end $$;

create trigger enforce_domain before insert on auth.users
  for each row execute function public.enforce_domain();
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
create trigger on_auth_user_signed_in after update of last_sign_in_at on auth.users
  for each row execute function public.handle_user_sign_in();
