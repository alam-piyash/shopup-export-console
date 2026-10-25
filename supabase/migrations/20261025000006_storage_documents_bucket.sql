-- storage documents bucket
-- ===== Storage: private documents bucket =====
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)
on conflict (id) do nothing;

create policy "Members read documents" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_member(auth.uid()));
create policy "Members upload documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_member(auth.uid()));
create policy "Admins delete documents" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.has_role(auth.uid(), 'admin'));
