-- =====================================================================
-- OPTIONAL demo data. Run after schema.sql if you want sample records.
-- Admins can remove it any time from Access control > Remove demo data.
-- =====================================================================

insert into public.trades(id, code, importer_name, importer_country, exporter, exporter_address, products, sales_contract_no, contract_date,
  contract_amount, contract_amount_usd, exchange_rate, currency, payment_type, tolerance_pct, country_of_origin, country_of_destination,
  carriage_by, status, created_by, approved_at, is_demo) values
('d0000000-0000-4000-8000-000000000001','TRD-0001','Al Noor Foods LLC','United Arab Emirates','Unicorn Distribution Limited','Dhaka, Bangladesh','Fresh vegetables','DEMO/SU/01','2026-03-01',
  12200000, 100000, 122, 'BDT', 'Advance TT', 10, 'Bangladesh', 'United Arab Emirates', 'Air', 'active', '00000000-0000-0000-0000-000000000000', now(), true),
('d0000000-0000-4000-8000-000000000002','TRD-0002','Nordic Fresh AS','Norway','Unicorn Distribution Limited','Dhaka, Bangladesh','Frozen fish','DEMO/SU/02','2026-02-01',
  7869000, 64500, 122, 'BDT', 'After receiving TT', 10, 'Bangladesh', 'Norway', 'Air', 'closed', '00000000-0000-0000-0000-000000000000', now(), true),
('d0000000-0000-4000-8000-000000000003','TRD-0003','Gulf Harvest Trading','Qatar','Unicorn Distribution Limited','Dhaka, Bangladesh','Fresh fruits','DEMO/SU/03','2026-09-01',
  10004000, 82000, 122, 'BDT', 'Part TT', 10, 'Bangladesh', 'Qatar', 'Air', 'pending_approval', '00000000-0000-0000-0000-000000000000', null, true);

insert into public.trade_items(trade_id, sort_order, description, carton_size, hs_code, incoterm, quantity_kg, rate_per_kg, rate_usd_per_kg, line_total, is_demo) values
('d0000000-0000-4000-8000-000000000001',1,'Fresh vegetables','CTN 1KG x 10KG','0709 99 00','CFR',20000,610,5,12200000,true),
('d0000000-0000-4000-8000-000000000002',1,'Frozen fish','CTN 10KG','0303 89 00','CFR',12900,610,5,7869000,true),
('d0000000-0000-4000-8000-000000000003',1,'Fresh fruits','CTN 1KG x 10KG','0810 90 00','CFR',16400,610,5,10004000,true);

insert into public.exps(id, code, trade_id, shipment_id, amount, amount_usd, type, status, closed_at, created_by, is_demo) values
('d0000000-0000-4000-8000-0000000000e1','EXP-2026-0001','d0000000-0000-4000-8000-000000000001','SH-1001',3050000,25000,'regular','closed',now(),'00000000-0000-0000-0000-000000000000',true),
('d0000000-0000-4000-8000-0000000000e2','EXP-2026-0002','d0000000-0000-4000-8000-000000000001','SH-1002',3660000,30000,'regular','open',null,'00000000-0000-0000-0000-000000000000',true),
('d0000000-0000-4000-8000-0000000000e3','EXP-2026-0003','d0000000-0000-4000-8000-000000000001',null,2440000,20000,'advance','open',null,'00000000-0000-0000-0000-000000000000',true),
('d0000000-0000-4000-8000-0000000000e4','EXP-2026-0004','d0000000-0000-4000-8000-000000000002','SH-2001',2440000,20000,'regular','closed',now(),'00000000-0000-0000-0000-000000000000',true),
('d0000000-0000-4000-8000-0000000000e5','EXP-2026-0005','d0000000-0000-4000-8000-000000000002','SH-2002',3050000,25000,'regular','closed',now(),'00000000-0000-0000-0000-000000000000',true),
('d0000000-0000-4000-8000-0000000000e6','EXP-2026-0006','d0000000-0000-4000-8000-000000000002','SH-2003',2379000,19500,'regular','closed',now(),'00000000-0000-0000-0000-000000000000',true);

update public.exp_documents set status = 'final', file_name = 'Demo file', file_path = 'demo', uploaded_at = now(), finalized_at = now()
  where is_demo and (exp_id in ('d0000000-0000-4000-8000-0000000000e1','d0000000-0000-4000-8000-0000000000e4','d0000000-0000-4000-8000-0000000000e5','d0000000-0000-4000-8000-0000000000e6')
    or (exp_id = 'd0000000-0000-4000-8000-0000000000e2' and doc_type in ('Airway Bill','Bill of Export','Commercial Invoice and Packing List','EXP Form')));
update public.exp_documents set status = 'uploaded', file_name = 'Demo file', file_path = 'demo', uploaded_at = now()
  where is_demo and exp_id = 'd0000000-0000-4000-8000-0000000000e2' and doc_type = 'Phytosanitary Certificate';

insert into public.collections(id, code, trade_id, amount, amount_usd, bank_reference, status, created_by, approved_at, is_demo) values
('d0000000-0000-4000-8000-0000000000c1','COL-0001','d0000000-0000-4000-8000-000000000001',3050000,25000,'Demo TT ref 1001','approved','00000000-0000-0000-0000-000000000000',now(),true),
('d0000000-0000-4000-8000-0000000000c2','COL-0002','d0000000-0000-4000-8000-000000000002',7869000,64500,'Demo TT ref 2001','approved','00000000-0000-0000-0000-000000000000',now(),true),
('d0000000-0000-4000-8000-0000000000c3','COL-0003','d0000000-0000-4000-8000-000000000001',3660000,30000,'Demo TT ref 1002','pending_approval','00000000-0000-0000-0000-000000000000',null,true);
insert into public.collection_exps(collection_id, exp_id, amount) values
('d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000e1',3050000),
('d0000000-0000-4000-8000-0000000000c2','d0000000-0000-4000-8000-0000000000e4',2440000),
('d0000000-0000-4000-8000-0000000000c2','d0000000-0000-4000-8000-0000000000e5',3050000),
('d0000000-0000-4000-8000-0000000000c2','d0000000-0000-4000-8000-0000000000e6',2379000),
('d0000000-0000-4000-8000-0000000000c3','d0000000-0000-4000-8000-0000000000e2',3660000);

insert into public.incentives(id, code, exp_amount, net_proceed, freight, fob, incentive_pct, incentive_amount, net_proceed_usd, freight_usd, status, created_by, approved_at, is_demo) values
('d0000000-0000-4000-8000-0000000000a1','INC-0001',7869000,7700000,150000,7550000,10,755000,63114.75,1229.51,'approved','00000000-0000-0000-0000-000000000000',now(),true),
('d0000000-0000-4000-8000-0000000000a2','INC-0002',3050000,3000000,50000,2950000,10,295000,24590.16,409.84,'pending_approval','00000000-0000-0000-0000-000000000000',null,true);
insert into public.incentive_exps(incentive_id, exp_id, amount) values
('d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e4',2440000),
('d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e5',3050000),
('d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000e6',2379000),
('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000e1',3050000);

insert into public.trade_amendments(id, trade_id, amendment_no, amendment_date, reason, old_amount, new_amount, status, requested_by, approved_at, is_demo) values
('d0000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-000000000002',1,'2026-05-06','Demo amendment, shipment timeline confirmed, amount unchanged',7869000,7869000,'approved','00000000-0000-0000-0000-000000000000',now(),true);

insert into public.attachments(entity_type, entity_id, doc_type, file_path, file_name, uploaded_by, is_demo)
select 'trade_contract', id, 'Sales contract', 'demo', 'Demo file', '00000000-0000-0000-0000-000000000000'::uuid, true from public.trades where is_demo
union all select 'trade_amendment', 'd0000000-0000-4000-8000-0000000000b1'::uuid, 'Amendment copy', 'demo', 'Demo file', '00000000-0000-0000-0000-000000000000'::uuid, true
union all select 'collection', c.id, d, 'demo', 'Demo file', '00000000-0000-0000-0000-000000000000'::uuid, true
  from public.collections c, unnest(array['PRC','Ka Form','Swift Copy','TT Voucher']) d where c.is_demo
union all select 'incentive', i.id, d, 'demo', 'Demo file', '00000000-0000-0000-0000-000000000000'::uuid, true
  from public.incentives i, unnest(array['Freight Certificate','Forwarding Letter','PRC','TT Calculation Copy','Swift Copy','Ka Form','Association Certificate','Undertakings']) d where i.is_demo;

insert into public.activity_log(entity_type, entity_id, trade_id, action, details, actor_id, is_demo) values
('trade','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','trade_created','{"code":"TRD-0001","amount":12200000}',null,true),
('trade','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','trade_approved','{"code":"TRD-0001"}',null,true),
('exp','d0000000-0000-4000-8000-0000000000e1','d0000000-0000-4000-8000-000000000001','exp_closed','{"code":"EXP-2026-0001"}',null,true),
('collection','d0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-000000000001','collection_approved','{"code":"COL-0001","amount":3050000}',null,true),
('collection','d0000000-0000-4000-8000-0000000000c3','d0000000-0000-4000-8000-000000000001','collection_created','{"code":"COL-0003","amount":3660000}',null,true),
('incentive','d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-000000000001','incentive_created','{"code":"INC-0002","amount":295000}',null,true),
('trade','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002','trade_created','{"code":"TRD-0002","amount":7869000}',null,true),
('revision','d0000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-000000000002','revision_approved','{"amendment_no":1,"old_amount":7869000,"new_amount":7869000}',null,true),
('incentive','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-000000000002','incentive_approved','{"code":"INC-0001","amount":755000}',null,true),
('trade','d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000003','trade_created','{"code":"TRD-0003","amount":10004000}',null,true);

select setval('public.trade_code_seq', greatest((select last_value from public.trade_code_seq), 3));
select setval('public.exp_code_seq', greatest((select last_value from public.exp_code_seq), 6));
select setval('public.collection_code_seq', greatest((select last_value from public.collection_code_seq), 3));
select setval('public.incentive_code_seq', greatest((select last_value from public.incentive_code_seq), 2));
