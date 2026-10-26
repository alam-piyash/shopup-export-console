-- Performance: evaluate auth checks once per query instead of once per row,
-- and index foreign keys used in joins. No data changes.
begin;

do $$
declare t text;
begin
  foreach t in array array['trades','trade_items','trade_amendments','exps','exp_documents','attachments','collections','collection_exps','incentives','incentive_exps','activity_log'] loop
    execute format('drop policy if exists "Members read" on public.%I', t);
    execute format('drop policy if exists "Admins delete" on public.%I', t);
    execute format('create policy "Members read" on public.%I for select to authenticated using ((select public.is_member((select auth.uid()))))', t);
    execute format('create policy "Admins delete" on public.%I for delete to authenticated using ((select public.has_role((select auth.uid()), ''admin'')))', t);
  end loop;
end $$;

drop policy if exists "Members read profiles" on public.profiles;
create policy "Members read profiles" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_member((select auth.uid()))));

drop policy if exists "Read own role or admin reads all" on public.user_roles;
create policy "Read own role or admin reads all" on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role((select auth.uid()), 'admin')));

drop policy if exists "Admins read preassignments" on public.role_preassignments;
create policy "Admins read preassignments" on public.role_preassignments for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin')));

drop policy if exists "Members read documents" on storage.objects;
create policy "Members read documents" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (select public.is_member((select auth.uid()))));
drop policy if exists "Members upload documents" on storage.objects;
create policy "Members upload documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (select public.is_member((select auth.uid()))));
drop policy if exists "Admins delete documents" on storage.objects;
create policy "Admins delete documents" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (select public.has_role((select auth.uid()), 'admin')));

create index if not exists collection_exps_exp_id_idx on public.collection_exps(exp_id);
create index if not exists collections_trade_id_idx on public.collections(trade_id);
create index if not exists incentive_exps_exp_id_idx on public.incentive_exps(exp_id);
create index if not exists exps_status_idx on public.exps(status);

commit;
