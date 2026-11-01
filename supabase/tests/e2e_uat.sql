-- End to end test of the ShopUp Export Console database rules.
-- Runs as an admin user (JWT claims set below), creates UAT data, and records each check in uat_results.
-- Test records are named UAT (buyer "UAT Test Buyer LLC", SC "UAT/SU/01") so they are easy to find and remove.
begin;
create temp table uat_results(n serial, step text, ok boolean, detail text) on commit drop;

do $$
declare
  v_uid uuid := '63fbdd93-e07a-48dd-9cfc-6dc89f8eaeeb';
  v_file jsonb := '{"path":"exps/c9ca45db-3c10-4734-9494-bcdd58853217/Screenshot_2026-10-26_at_1.41.22_PM.png","name":"uat-sample.png","size":120000}';
  v_profile uuid; v_buyer uuid; v_trade uuid; v_code text; v_exp1 uuid; v_exp2 uuid; v_col uuid; v_inc uuid; v_amd uuid;
  v_gen uuid; v_up uuid; v_change uuid; v_doc uuid; v_n int; v_amt numeric; v_txt text; r record;
  procedure_ok boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);

  -- helper style: each check in its own block
  begin
    if auth.uid() = v_uid then insert into uat_results(step, ok, detail) values ('Acting as admin user', true, 'tasnim.piyash@shopup.org');
    else insert into uat_results(step, ok, detail) values ('Acting as admin user', false, coalesce(auth.uid()::text,'null')); end if;
  end;

  -- 1. Masters
  begin
    select id into v_profile from public.company_profiles where is_default;
    v_buyer := public.save_buyer('{"name":"UAT Test Buyer LLC","country":"KSA","cr_no":"UAT-CR-001","address":"UAT Street, Riyadh","point_of_entry":"Riyadh Int''l Airport","notify_parties":[{"name":"UAT Notify Ltd","address":"Singapore"}]}'::jsonb);
    insert into uat_results(step, ok, detail) values ('Masters: save buyer', v_buyer is not null, 'UAT Test Buyer LLC');
  exception when others then insert into uat_results(step, ok, detail) values ('Masters: save buyer', false, sqlerrm);
  end;
  begin
    perform public.save_buyer('{"name":"uat test buyer llc"}'::jsonb);
    insert into uat_results(step, ok, detail) values ('Masters: duplicate buyer refused', false, 'was accepted');
  exception when others then insert into uat_results(step, ok, detail) values ('Masters: duplicate buyer refused', true, sqlerrm);
  end;

  -- 2. Trade
  begin
    v_trade := public.create_trade(
      jsonb_build_object('exporter','Unicorn Distribution Limited','importer_name','UAT Test Buyer LLC','importer_country','KSA',
        'sales_contract_no','UAT/SU/01','contract_date', to_char(current_date - 20,'YYYY-MM-DD'),'shipment_deadline', to_char(current_date + 40,'YYYY-MM-DD'),
        'expiry_date', to_char(current_date + 120,'YYYY-MM-DD'),'carriage_by','Air','payment_type','Advance TT','tolerance_pct','10','exchange_rate','122',
        'contract_amount_usd','42800','company_profile_id', v_profile, 'buyer_id', v_buyer, 'country_of_destination','KSA',
        'contract_extra', '{"signatory_name":"Ataur Rahim Chowdhury","signatory_designation":"Managing Director"}'::jsonb),
      '[{"description":"VEGETABLE","carton_size":"1 KG x 10 PCS","hs_code":"0711 90 00","incoterm":"CFR","quantity_kg":"10000","rate_per_kg":"268.4","rate_usd_per_kg":"2.2"},
        {"description":"FRESH BETEL LEAVES","carton_size":"1 KG x 9 PCS","hs_code":"1404 90 92","incoterm":"CFR","quantity_kg":"2000","rate_per_kg":"780.8","rate_usd_per_kg":"6.4"},
        {"description":"Freight Cost (Subject to Change)","carton_size":"","hs_code":"","incoterm":"","quantity_kg":"1","rate_per_kg":"976000","rate_usd_per_kg":"8000"}]'::jsonb,
      null);
    select code, contract_amount into v_code, v_amt from public.trades where id = v_trade;
    insert into uat_results(step, ok, detail) values ('Trade: create with 2 items and freight', v_amt = 5221600, v_code || ' amount ' || v_amt);
  exception when others then insert into uat_results(step, ok, detail) values ('Trade: create', false, sqlerrm);
  end;
  begin
    perform public.create_trade(jsonb_build_object('exporter','x','importer_name','x','importer_country','x','sales_contract_no','uat/su/01','contract_date','2026-11-01'),
      '[{"description":"x","quantity_kg":"1","rate_per_kg":"1"}]'::jsonb, null);
    insert into uat_results(step, ok, detail) values ('Trade: duplicate SC number refused', false, 'was accepted');
  exception when others then insert into uat_results(step, ok, detail) values ('Trade: duplicate SC number refused', true, sqlerrm);
  end;
  begin
    select shipment_deadline::text into v_txt from public.trades where id = v_trade;
    insert into uat_results(step, ok, detail) values ('Trade: shipment deadline stored', v_txt is not null, v_txt);
  end;

  -- 3. Approval and the signed contract rule
  begin
    perform public.approve_trade(v_trade);
    select status::text into v_txt from public.trades where id = v_trade;
    insert into uat_results(step, ok, detail) values ('Trade: admin approves', v_txt = 'active', v_txt);
  exception when others then insert into uat_results(step, ok, detail) values ('Trade: admin approves', false, sqlerrm);
  end;
  begin
    perform public.create_exp(v_trade, 1000, false, '{"shipment_id":"X"}'::jsonb);
    insert into uat_results(step, ok, detail) values ('EXP: refused before signed contract', false, 'was accepted');
  exception when others then insert into uat_results(step, ok, detail) values ('EXP: refused before signed contract', true, sqlerrm);
  end;

  -- 4. Sales contract versions
  begin
    v_gen := public.add_contract_version(v_trade, v_file, 'generated', 'Generated from the trade form');
    v_up := public.add_contract_version(v_trade, v_file, 'uploaded', 'Signed by both parties', 'Signed', current_date);
    select count(*) into v_n from public.contract_documents where trade_id = v_trade;
    insert into uat_results(step, ok, detail) values ('Contract: generated v1 and uploaded v2 kept', v_n = 2, v_n || ' versions');
  exception when others then insert into uat_results(step, ok, detail) values ('Contract: add versions', false, sqlerrm);
  end;
  begin
    perform public.mark_contract_signed(v_gen);
    insert into uat_results(step, ok, detail) values ('Contract: generated draft cannot be marked signed', false, 'was accepted');
  exception when others then insert into uat_results(step, ok, detail) values ('Contract: generated draft cannot be marked signed', true, sqlerrm);
  end;
  begin
    perform public.mark_contract_signed(v_up);
    select contract_signed::text into v_txt from public.trade_overview where id = v_trade;
    insert into uat_results(step, ok, detail) values ('Contract: uploaded copy marked signed', v_txt = 'true', 'contract_signed ' || v_txt);
  exception when others then insert into uat_results(step, ok, detail) values ('Contract: mark signed', false, sqlerrm);
  end;

  -- 5. EXPs
  begin
    v_exp1 := public.create_exp(v_trade, 2000000, false, '{"shipment_id":"SH-UAT-1","exp_no":"UAT-EXP-0001","awb_no":"176-0000001","flight_no":"EK585","shipment_date":"2026-10-20","amount_usd":"16393.44"}'::jsonb);
    v_exp2 := public.create_exp(v_trade, 1000000, true, '{"exp_no":"UAT-EXP-0002"}'::jsonb);
    select count(*) into v_n from public.exp_documents where exp_id = v_exp1;
    insert into uat_results(step, ok, detail) values ('EXP: regular and advance created, 8 documents each', v_n = 8, v_n || ' document slots');
  exception when others then insert into uat_results(step, ok, detail) values ('EXP: create', false, sqlerrm);
  end;
  begin
    perform public.create_exp(v_trade, 3000000, false, '{"shipment_id":"SH-UAT-X"}'::jsonb);
    insert into uat_results(step, ok, detail) values ('EXP: over the contract amount refused', false, 'was accepted');
  exception when others then insert into uat_results(step, ok, detail) values ('EXP: over the contract amount refused', true, sqlerrm);
  end;
  begin
    perform public.create_exp(v_trade, 1000, false, '{"shipment_id":"SH-UAT-Y","exp_no":"uat-exp-0001"}'::jsonb);
    insert into uat_results(step, ok, detail) values ('EXP: duplicate EXP number refused', false, 'was accepted');
  exception when others then insert into uat_results(step, ok, detail) values ('EXP: duplicate EXP number refused', true, sqlerrm);
  end;
  begin
    select id into v_doc from public.exp_documents where exp_id = v_exp2 order by sort_order limit 1;
    perform public.upload_exp_document(v_doc, v_file, 'Submitted', null, current_date);
    insert into uat_results(step, ok, detail) values ('EXP docs: upload refused on advance EXP without shipment ID', false, 'was accepted');
  exception when others then insert into uat_results(step, ok, detail) values ('EXP docs: upload refused on advance EXP without shipment ID', true, sqlerrm);
  end;

  -- 6. EXP document lifecycle: Bill of Export gets 3 versions, then final
  begin
    select id into v_doc from public.exp_documents where exp_id = v_exp1 and doc_type = 'Bill of Export';
    perform public.upload_exp_document(v_doc, v_file, 'Submitted', null, current_date - 6);
    perform public.upload_exp_document(v_doc, v_file, 'Signed', 'Signed by buyer', current_date - 3);
    perform public.upload_exp_document(v_doc, v_file, 'Bangladesh Bank signed', 'Signed by both parties and Bangladesh Bank', current_date);
    select count(*) into v_n from public.exp_document_versions where doc_id = v_doc;
    insert into uat_results(step, ok, detail) values ('EXP docs: 3 versions kept with stages', v_n = 3, v_n || ' versions');
    perform public.finalize_exp_document(v_doc);
    select count(*) into v_n from public.exp_document_versions where doc_id = v_doc and is_final and version = 3;
    insert into uat_results(step, ok, detail) values ('EXP docs: mark final uses the latest version', v_n = 1, 'v3 final');
  exception when others then insert into uat_results(step, ok, detail) values ('EXP docs: lifecycle', false, sqlerrm);
  end;
  begin
    perform public.upload_exp_document(v_doc, v_file, 'Signed', null, current_date);
    insert into uat_results(step, ok, detail) values ('EXP docs: no new version after final', false, 'was accepted');
  exception when others then insert into uat_results(step, ok, detail) values ('EXP docs: no new version after final', true, sqlerrm);
  end;
  begin
    for r in select id from public.exp_documents where exp_id = v_exp1 and status <> 'final' loop
      perform public.upload_exp_document(r.id, v_file, 'Submitted', null, current_date);
      perform public.finalize_exp_document(r.id);
    end loop;
    select status::text into v_txt from public.exps where id = v_exp1;
    insert into uat_results(step, ok, detail) values ('EXP: closes automatically when all 8 documents are final', v_txt = 'closed', v_txt);
  exception when others then insert into uat_results(step, ok, detail) values ('EXP: auto close', false, sqlerrm);
  end;

  -- 7. EXP amount change after close
  begin
    v_change := public.request_exp_amount_change(v_exp1, 1950000, 15983.61, 'Actual shipped quantity lower than the EXP', v_file);
    select count(*) into v_n from public.documents where entity_type = 'exp_amount_change' and entity_id = v_change;
    insert into uat_results(step, ok, detail) values ('Amount change: requested on closed EXP with backing document', v_n = 1, 'backing document card created');
    perform public.decide_exp_amount_change(v_change, true, null);
    select amount, issued_amount::text into v_amt, v_txt from public.exps where id = v_exp1;
    insert into uat_results(step, ok, detail) values ('Amount change: approved, new amount used, issued amount kept', v_amt = 1950000 and v_txt = '2000000.00', 'amount ' || v_amt || ', issued ' || v_txt);
  exception when others then insert into uat_results(step, ok, detail) values ('Amount change', false, sqlerrm);
  end;
  begin
    perform public.request_exp_amount_change(v_exp2, 4000000, null, 'UAT over tolerance', v_file);
    insert into uat_results(step, ok, detail) values ('Amount change: above contract plus tolerance refused', false, 'was accepted');
  exception when others then insert into uat_results(step, ok, detail) values ('Amount change: above contract plus tolerance refused', true, sqlerrm);
  end;
  begin
    perform public.update_exp(v_exp2, 900000, '{}'::jsonb);
    insert into uat_results(step, ok, detail) values ('EXP edit: amount cannot change without a request', false, 'was accepted');
  exception when others then insert into uat_results(step, ok, detail) values ('EXP edit: amount cannot change without a request', true, sqlerrm);
  end;

  -- 8. Follow-up
  begin
    perform public.mark_followup_done(v_trade, 1, 'Checked with logistics');
    select followups_done::text into v_txt from public.trade_overview where id = v_trade;
    insert into uat_results(step, ok, detail) values ('Follow-up: checkpoint 1 marked done', v_txt = '{1}', v_txt);
  exception when others then insert into uat_results(step, ok, detail) values ('Follow-up', false, sqlerrm);
  end;

  -- 9. Collection with its document lifecycle
  begin
    v_col := public.create_collection(v_trade, 1950000, 'UAT-TT-001', array[v_exp1],
      jsonb_build_array(v_file || '{"doc_type":"Swift Copy"}', v_file || '{"doc_type":"PRC"}', v_file || '{"doc_type":"TT Voucher"}'), 15983.61);
    select count(*) into v_n from public.documents where entity_type = 'collection' and entity_id = v_col;
    insert into uat_results(step, ok, detail) values ('Collection: created with 3 document cards', v_n = 3, v_n || ' documents');
    perform public.decide_collection(v_col, true, null);
    select id into v_doc from public.documents where entity_type = 'collection' and entity_id = v_col and doc_type = 'PRC';
    perform public.add_document_version(v_doc, v_file, 'Signed', 'Bank signed PRC', current_date);
    perform public.finalize_document(v_doc);
    select version_count, status into v_n, v_txt from public.documents where id = v_doc;
    insert into uat_results(step, ok, detail) values ('Collection docs: PRC v2 added and marked final', v_n = 2 and v_txt = 'final', 'v' || v_n || ' ' || v_txt);
  exception when others then insert into uat_results(step, ok, detail) values ('Collection', false, sqlerrm);
  end;
  begin
    perform public.create_collection(v_trade, 1000, null, array[v_exp1], '[]'::jsonb, null);
    insert into uat_results(step, ok, detail) values ('Collection: same EXP twice refused', false, 'was accepted');
  exception when others then insert into uat_results(step, ok, detail) values ('Collection: same EXP twice refused', true, sqlerrm);
  end;

  -- 10. Incentive
  begin
    v_inc := public.create_incentive(array[v_exp1], 1900000, 100000, 1,
      jsonb_build_array(v_file || '{"doc_type":"Ka Form"}', v_file || '{"doc_type":"Association Certificate"}', v_file || '{"doc_type":"Forwarding Letter"}',
        v_file || '{"doc_type":"Overdue Certificate"}', v_file || '{"doc_type":"Undertakings"}'), null, null);
    select incentive_amount into v_amt from public.incentives where id = v_inc;
    insert into uat_results(step, ok, detail) values ('Incentive: FOB 18,00,000 at 1% gives 18,000', v_amt = 18000, 'incentive ' || v_amt);
    perform public.decide_incentive(v_inc, true, null);
    select count(*) into v_n from public.documents where entity_type = 'incentive' and entity_id = v_inc;
    insert into uat_results(step, ok, detail) values ('Incentive: approved with 5 document cards', v_n = 5, v_n || ' documents');
  exception when others then insert into uat_results(step, ok, detail) values ('Incentive', false, sqlerrm);
  end;

  -- 11. Amendment
  begin
    v_amd := public.request_amendment(v_trade,
      jsonb_build_object('reason','UAT: buyer increased betel leaves to 3,000 KG','amendment_date', to_char(current_date,'YYYY-MM-DD'),'amendment_no','1','new_shipment_timeline', to_char(current_date + 60,'DD/MM/YYYY')),
      '[{"description":"VEGETABLE","carton_size":"1 KG x 10 PCS","hs_code":"0711 90 00","incoterm":"CFR","quantity_kg":"10000","rate_per_kg":"268.4","rate_usd_per_kg":"2.2"},
        {"description":"FRESH BETEL LEAVES","carton_size":"1 KG x 9 PCS","hs_code":"1404 90 92","incoterm":"CFR","quantity_kg":"3000","rate_per_kg":"780.8","rate_usd_per_kg":"6.4"},
        {"description":"Freight Cost (Subject to Change)","quantity_kg":"1","rate_per_kg":"976000","rate_usd_per_kg":"8000"}]'::jsonb,
      v_file || '{"name":"UAT-amendment-01.pdf"}', '[]'::jsonb);
    perform public.approve_amendment(v_amd);
    select contract_amount, shipment_deadline::text into v_amt, v_txt from public.trades where id = v_trade;
    insert into uat_results(step, ok, detail) values ('Amendment: approved, amount and deadline updated', v_amt = 6002400 and v_txt = to_char(current_date + 60,'YYYY-MM-DD'), 'amount ' || v_amt || ', deadline ' || v_txt);
    select count(*) into v_n from public.documents where entity_type = 'trade_amendment' and entity_id = v_amd;
    insert into uat_results(step, ok, detail) values ('Amendment: copy kept as a document card', v_n = 1, v_n || ' document');
  exception when others then insert into uat_results(step, ok, detail) values ('Amendment', false, sqlerrm);
  end;

  -- 12. Activity log
  begin
    select count(*) into v_n from public.activity_log where trade_id = v_trade;
    insert into uat_results(step, ok, detail) values ('Activity log: every step recorded', v_n >= 20, v_n || ' entries');
  end;
end $$;

select n, case when ok then 'PASS' else 'FAIL' end as result, step, detail from uat_results order by n;
commit;
