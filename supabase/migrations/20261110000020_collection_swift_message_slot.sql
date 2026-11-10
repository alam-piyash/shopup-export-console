-- Collections made before the Swift Message became the submitted file get an empty Swift Message slot,
-- shown first, so it can be uploaded from the collection page. Adds rows only; nothing is changed or removed.
insert into public.documents(entity_type, entity_id, trade_id, doc_type, sort_order, is_demo)
select 'collection', c.id, c.trade_id, 'Swift Message', 0, coalesce(c.is_demo, false)
from public.collections c
where not exists (select 1 from public.documents d where d.entity_type = 'collection' and d.entity_id = c.id and d.doc_type = 'Swift Message');
