-- Collections: Swift Message is the required file. Swift Copy, PRC and TT Voucher can stay pending
-- and be added later from the collection page (their document rows start as 'missing').

create or replace function public.create_collection(p_trade uuid, p_amount numeric, p_bank_ref text, p_exp_ids uuid[], p_docs jsonb, p_amount_usd numeric default null::numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_t public.trades; v_sum numeric; v_cnt int; v_id uuid; v_code text; d text; v_file jsonb; i int := 0;
  v_types text[] := array['Swift Message','Swift Copy','PRC','TT Voucher'];
begin
  perform public.require_member();
  select * into v_t from public.trades where id = p_trade;
  if v_t.id is null then raise exception 'Trade not found'; end if;
  if v_t.status not in ('active','revision_pending') then raise exception 'Collections can only be made on active trades'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount received must be greater than 0'; end if;
  if p_exp_ids is null or array_length(p_exp_ids,1) is null then raise exception 'Select at least one EXP'; end if;
  select count(*), coalesce(sum(amount),0) into v_cnt, v_sum from public.exps where id = any(p_exp_ids) and trade_id = p_trade;
  if v_cnt <> array_length(p_exp_ids,1) then raise exception 'All selected EXPs must belong to %', v_t.code; end if;
  if exists (select 1 from public.collection_exps ce join public.collections c on c.id = ce.collection_id
             where ce.exp_id = any(p_exp_ids) and c.status in ('pending_approval','approved')) then
    raise exception 'One or more selected EXPs are already in a pending or approved collection';
  end if;
  if v_sum <> round(p_amount,2) then
    raise exception 'Selected EXPs total % must equal the amount received %', public.fmt_bdt(v_sum), public.fmt_bdt(p_amount);
  end if;
  select x into v_file from jsonb_array_elements(coalesce(p_docs,'[]'::jsonb)) x where x->>'doc_type' = 'Swift Message' limit 1;
  if v_file is null or coalesce(v_file->>'path','') = '' then raise exception 'Swift Message is required'; end if;
  insert into public.collections(trade_id, amount, amount_usd, bank_reference, created_by)
  values (p_trade, round(p_amount,2), round(p_amount_usd,2), nullif(trim(p_bank_ref),''), auth.uid()) returning id, code into v_id, v_code;
  insert into public.collection_exps(collection_id, exp_id, amount) select v_id, id, amount from public.exps where id = any(p_exp_ids);
  foreach d in array v_types loop
    i := i + 1;
    v_file := null;
    select x into v_file from jsonb_array_elements(coalesce(p_docs,'[]'::jsonb)) x where x->>'doc_type' = d limit 1;
    if v_file is not null and coalesce(v_file->>'path','') <> '' then
      perform public.add_attachment('collection', v_id, d, v_file);
    else
      -- pending: a document card to upload later
      insert into public.documents(entity_type, entity_id, trade_id, doc_type, sort_order)
      values ('collection', v_id, p_trade, d, i) on conflict (entity_type, entity_id, doc_type) do nothing;
    end if;
  end loop;
  perform public.log_activity('collection', v_id, p_trade, 'collection_created', jsonb_build_object('code', v_code, 'amount', p_amount));
  return v_id;
end $function$;

-- document order for collections now starts with Swift Message
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.add_attachment(text, uuid, text, jsonb)'::regprocedure);
  if position('array[''Swift Copy'',''PRC'',''TT Voucher'']' in d) = 0 then raise exception 'add_attachment: anchor not found'; end if;
  d := replace(d, 'array[''Swift Copy'',''PRC'',''TT Voucher'']', 'array[''Swift Message'',''Swift Copy'',''PRC'',''TT Voucher'']');
  execute d;
end $mig$;

grant execute on function public.create_collection(uuid, numeric, text, uuid[], jsonb, numeric) to authenticated;
