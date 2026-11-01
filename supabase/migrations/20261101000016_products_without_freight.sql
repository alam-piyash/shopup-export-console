-- UAT fix: the product summary on a trade should not list the freight line.
create or replace function public.replace_trade_items(p_trade uuid, p_items jsonb)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_total numeric;
begin
  delete from public.trade_items where trade_id = p_trade;
  insert into public.trade_items(trade_id, sort_order, description, carton_size, hs_code, incoterm, quantity_kg, rate_per_kg, rate_usd_per_kg, line_total)
  select p_trade, ord, x->>'description', x->>'carton_size', x->>'hs_code', x->>'incoterm',
    (x->>'quantity_kg')::numeric, (x->>'rate_per_kg')::numeric, nullif(x->>'rate_usd_per_kg','')::numeric, (x->>'line_total')::numeric
  from jsonb_array_elements(p_items) with ordinality as a(x, ord);
  select coalesce(sum(line_total),0) into v_total from public.trade_items where trade_id = p_trade;
  update public.trades set products = coalesce((select string_agg(description, ', ' order by sort_order) from public.trade_items
    where trade_id = p_trade and description !~* '^\(?\+?\)?\s*freight cost'), '')
  where id = p_trade;
  return v_total;
end $function$;

update public.trades t set products = coalesce((select string_agg(description, ', ' order by sort_order) from public.trade_items i
  where i.trade_id = t.id and i.description !~* '^\(?\+?\)?\s*freight cost'), '')
where products ~* 'freight cost';
