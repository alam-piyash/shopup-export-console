-- EXPs: cartons and gross weight (used by the Commercial Invoice / Packing List generator),
-- and "Regular" instead of "Duplicate" in messages. Existing functions are patched in place.
alter table public.exps
  add column if not exists cartons int,
  add column if not exists gross_weight numeric;
comment on column public.exps.cartons is 'Number of cartons (BoE box 31)';
comment on column public.exps.gross_weight is 'Gross weight KG (BoE box 35)';
comment on column public.exps.type is 'advance = Advance EXP, regular = Regular EXP';

do $mig$
declare d text;
begin
  -- exp_apply_fields: read cartons and gross_weight
  d := pg_get_functiondef('public.exp_apply_fields(public.exps, jsonb)'::regprocedure);
  if position('if f ? ''freight'' then' in d) = 0 then raise exception 'exp_apply_fields: anchor not found'; end if;
  d := replace(d, 'if f ? ''freight'' then', $x$if f ? 'cartons' then
    v := nullif(trim(f->>'cartons'), '');
    if v is not null and v !~ '^\d+$' then raise exception 'Cartons must be a whole number: %', v; end if;
    e.cartons := v::int;
  end if;
  if f ? 'gross_weight' then
    v := nullif(trim(f->>'gross_weight'), '');
    if v is not null and (v !~ '^\d+(\.\d+)?$') then raise exception 'Gross weight must be a number: %', v; end if;
    e.gross_weight := v::numeric;
  end if;
  if f ? 'freight' then$x$);
  execute d;

  -- create_exp: save the two fields, Regular wording
  d := pg_get_functiondef('public.create_exp(uuid, numeric, boolean, jsonb)'::regprocedure);
  if position('export_bill_no, export_bill_date, shipment_id, flight_no)' in d) = 0 or position('v_e.shipment_id, v_e.flight_no)' in d) = 0 then
    raise exception 'create_exp: anchor not found';
  end if;
  d := replace(d, 'export_bill_no, export_bill_date, shipment_id, flight_no)', 'export_bill_no, export_bill_date, shipment_id, flight_no, cartons, gross_weight)');
  d := replace(d, 'v_e.shipment_id, v_e.flight_no)', 'v_e.shipment_id, v_e.flight_no, v_e.cartons, v_e.gross_weight)');
  d := replace(d, 'then ''Duplicate'' else ''Advance''', 'then ''Regular'' else ''Advance''');
  execute d;

  -- update_exp: save the two fields, Regular wording
  d := pg_get_functiondef('public.update_exp(uuid, numeric, jsonb)'::regprocedure);
  if position('flight_no = v_e.flight_no' in d) = 0 then raise exception 'update_exp: anchor not found'; end if;
  d := replace(d, 'flight_no = v_e.flight_no', 'flight_no = v_e.flight_no, cartons = v_e.cartons, gross_weight = v_e.gross_weight');
  d := replace(d, 'is a Duplicate EXP and cannot go back', 'is a Regular EXP and cannot go back');
  d := replace(d, 'a Duplicate EXP, fill', 'a Regular EXP, fill');
  d := replace(d, 'Advance or Duplicate', 'Advance or Regular');
  execute d;

  -- bulk_exps: Regular wording
  d := pg_get_functiondef('public.bulk_exps(text, jsonb, boolean)'::regprocedure);
  d := replace(d, 'Advance or Duplicate', 'Advance or Regular');
  execute d;

  -- exp_overview: append the two columns
  d := pg_get_viewdef('public.exp_overview'::regclass);
  if position('AS fields_missing' in d) = 0 then raise exception 'exp_overview: anchor not found'; end if;
  d := replace(d, 'AS fields_missing', 'AS fields_missing, e.cartons, e.gross_weight');
  execute 'create or replace view public.exp_overview with (security_invoker = true) as ' || rtrim(trim(d), ';');
end $mig$;

grant execute on function public.create_exp(uuid, numeric, boolean, jsonb) to authenticated;
grant execute on function public.update_exp(uuid, numeric, jsonb) to authenticated;
grant execute on function public.bulk_exps(text, jsonb, boolean) to authenticated;
