package httpapi

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/lib/pq"

	"github.com/alam-piyash/shopup-export-console/api/internal/db"
)

// Every read runs as the signed-in user, so the RLS policies decide which rows come back.

func (s *Server) readRoutes(r chi.Router) {
	r.Get("/me", s.me)
	r.Get("/pending-counts", s.value("select public.pending_counts()"))
	r.Get("/demo-count", s.value("select public.demo_count()"))
	r.Get("/profiles", s.list("select id, full_name, email from public.profiles"))
	r.Get("/activity", s.activity)
	r.Get("/access", s.access)

	// masters
	r.Get("/company-profiles", s.list("select * from public.company_profiles order by label"))
	r.Get("/buyers", s.list("select * from public.buyers order by name"))
	r.Get("/products", s.list("select * from public.products order by description"))

	// trades
	r.Get("/trades", s.trades)
	r.Get("/trades/{id}", s.trade)
	r.Get("/trades/{id}/items", s.listByID("select * from public.trade_items where trade_id = $1 order by sort_order"))
	r.Get("/trades/{id}/amendments", s.listByID("select * from public.trade_amendments where trade_id = $1 order by amendment_no desc"))
	r.Get("/trades/{id}/followups", s.listByID("select * from public.trade_followups where trade_id = $1"))
	r.Get("/trades/{id}/contract-documents", s.contractDocs)
	r.Get("/trades/{id}/prepaids", s.listByID(`select id, code, amount, created_at, status, kind, source_collection_id
		from public.collections where trade_id = $1 and kind in ('prepaid', 'settlement')`))

	// EXPs
	r.Get("/exps", s.exps)
	r.Get("/exps/{id}", s.exp)
	r.Get("/exps/{id}/amount-changes", s.listByID("select * from public.exp_amount_changes where exp_id = $1 order by created_at desc"))
	r.Get("/exps/{id}/ci-sources", s.ciSources)

	// collections and incentives
	r.Get("/collections", s.list(collectionsSQL))
	r.Get("/collections/{id}", s.oneByID("select * from public.collections where id = $1"))
	r.Get("/incentives", s.list(incentivesSQL))

	// files and documents attached to records
	r.Get("/attachments", s.attachments)
	r.Get("/documents", s.documents)
}

// list serves a fixed query.
func (s *Server) list(q string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var out json.RawMessage
		err := s.tx(r, func(tx *sql.Tx) (err error) { out, err = db.List(r.Context(), tx, q); return })
		s.respond(w, r, out, err)
	}
}

// value serves a single value, for example the result of a function.
func (s *Server) value(q string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var out json.RawMessage
		err := s.tx(r, func(tx *sql.Tx) (err error) { out, err = db.Value(r.Context(), tx, q); return })
		s.respond(w, r, out, err)
	}
}

// listByID serves a query whose $1 is the {id} path parameter.
func (s *Server) listByID(q string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "id")
		if !ok {
			return
		}
		var out json.RawMessage
		err := s.tx(r, func(tx *sql.Tx) (err error) { out, err = db.List(r.Context(), tx, q, id); return })
		s.respond(w, r, out, err)
	}
}

// oneByID serves one row whose $1 is the {id} path parameter.
func (s *Server) oneByID(q string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "id")
		if !ok {
			return
		}
		var out json.RawMessage
		err := s.tx(r, func(tx *sql.Tx) (err error) { out, err = db.One(r.Context(), tx, q, id); return })
		s.respond(w, r, out, err)
	}
}

// me returns the signed-in user with profile and role.
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	c := claimsOf(r)
	var out json.RawMessage
	err := s.tx(r, func(tx *sql.Tx) (err error) {
		meta, _ := json.Marshal(c["user_metadata"])
		out, err = db.One(r.Context(), tx, `
			select $1::uuid as id, $2::text as email,
			       coalesce(p.full_name, m->>'full_name', m->>'name') as full_name,
			       coalesce(p.avatar_url, m->>'avatar_url') as avatar_url,
			       ur.role
			from (select $3::jsonb as m) meta
			left join public.profiles p on p.id = $1::uuid
			left join public.user_roles ur on ur.user_id = $1::uuid`,
			c.Sub(), c.Email(), string(meta))
		return
	})
	s.respond(w, r, out, err)
}

func (s *Server) activity(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 12
	}
	if limit > 500 {
		limit = 500
	}
	trade := r.URL.Query().Get("trade_id")
	var out json.RawMessage
	err := s.tx(r, func(tx *sql.Tx) (err error) {
		if trade != "" {
			if !isUUID(trade) {
				return badInput("trade_id must be a UUID")
			}
			out, err = db.List(r.Context(), tx, "select * from public.activity_log where trade_id = $1 order by created_at desc limit $2", trade, limit)
			return
		}
		out, err = db.List(r.Context(), tx, "select * from public.activity_log order by created_at desc limit $1", limit)
		return
	})
	s.respond(w, r, out, err)
}

func (s *Server) access(w http.ResponseWriter, r *http.Request) {
	var out json.RawMessage
	err := s.tx(r, func(tx *sql.Tx) (err error) {
		out, err = db.Value(r.Context(), tx, `select json_build_object(
			'profiles', coalesce((select json_agg(p order by p.created_at) from public.profiles p), '[]'),
			'roles', coalesce((select json_agg(u) from public.user_roles u), '[]'),
			'preassignments', coalesce((select json_agg(a order by a.created_at) from public.role_preassignments a), '[]'))`)
		return
	})
	s.respond(w, r, out, err)
}

// trades lists trade_overview, newest first. ?status=active,revision_pending filters by status.
func (s *Server) trades(w http.ResponseWriter, r *http.Request) {
	statuses := splitList(r.URL.Query().Get("status"))
	var out json.RawMessage
	err := s.tx(r, func(tx *sql.Tx) (err error) {
		if len(statuses) > 0 {
			out, err = db.List(r.Context(), tx, "select * from public.trade_overview where status::text = any($1) order by created_at desc", pq.Array(statuses))
			return
		}
		out, err = db.List(r.Context(), tx, "select * from public.trade_overview order by created_at desc")
		return
	})
	s.respond(w, r, out, err)
}

// trade returns one trade with its EXPs.
func (s *Server) trade(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "id")
	if !ok {
		return
	}
	var out json.RawMessage
	err := s.tx(r, func(tx *sql.Tx) error {
		t, err := db.One(r.Context(), tx, "select * from public.trade_overview where id = $1", id)
		if err != nil {
			return err
		}
		exps, err := db.List(r.Context(), tx, "select * from public.exp_overview where trade_id = $1 order by created_at, id", id)
		if err != nil {
			return err
		}
		out, err = json.Marshal(map[string]json.RawMessage{"trade": t, "exps": exps})
		return err
	})
	s.respond(w, r, out, err)
}

// contractDocs lists sales contract versions, newest first. ?source=uploaded filters by source.
func (s *Server) contractDocs(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "id")
	if !ok {
		return
	}
	source := r.URL.Query().Get("source")
	var out json.RawMessage
	err := s.tx(r, func(tx *sql.Tx) (err error) {
		out, err = db.List(r.Context(), tx, `select * from public.contract_documents
			where trade_id = $1 and ($2 = '' or source = $2) order by version desc`, id, source)
		return
	})
	s.respond(w, r, out, err)
}

// exps lists exp_overview.
// Filters: trade_id, outstanding=true (amount still to collect), incentive_eligible=true
// (fully collected and not yet claimed). order=asc lists oldest first (default newest first).
func (s *Server) exps(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"true"}
	var args []any
	if t := q.Get("trade_id"); t != "" {
		if !isUUID(t) {
			s.fail(w, r, badInput("trade_id must be a UUID"))
			return
		}
		args = append(args, t)
		where = append(where, "trade_id = $"+strconv.Itoa(len(args)))
	}
	if q.Get("outstanding") == "true" {
		where = append(where, "outstanding_amount > 0")
	}
	if q.Get("incentive_eligible") == "true" {
		where = append(where, "collection_status = 'approved' and incentive_status is null")
	}
	order := "created_at desc, id"
	if q.Get("order") == "asc" {
		order = "created_at, id"
	}
	query := "select * from public.exp_overview where " + strings.Join(where, " and ") + " order by " + order
	var out json.RawMessage
	err := s.tx(r, func(tx *sql.Tx) (err error) { out, err = db.List(r.Context(), tx, query, args...); return })
	s.respond(w, r, out, err)
}

// exp returns one EXP with its document slots, versions and the trade figures the page needs.
func (s *Server) exp(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "id")
	if !ok {
		return
	}
	var out json.RawMessage
	err := s.tx(r, func(tx *sql.Tx) error {
		e, err := db.One(r.Context(), tx, "select * from public.exp_overview where id = $1", id)
		if err != nil {
			return err
		}
		docs, err := db.List(r.Context(), tx, "select * from public.exp_documents where exp_id = $1 order by sort_order", id)
		if err != nil {
			return err
		}
		trade, err := db.One(r.Context(), tx, `select t.contract_amount, t.exp_issued, t.tolerance_pct, t.status
			from public.trade_overview t join public.exps e on e.trade_id = t.id where e.id = $1`, id)
		if err != nil && err != db.ErrNotFound {
			return err
		}
		if trade == nil {
			trade = json.RawMessage("null")
		}
		versions, err := db.List(r.Context(), tx, "select * from public.exp_document_versions where exp_id = $1 order by version desc", id)
		if err != nil {
			return err
		}
		out, err = json.Marshal(map[string]json.RawMessage{"exp": e, "docs": docs, "trade": trade, "versions": versions})
		return err
	})
	s.respond(w, r, out, err)
}

// ciSources returns what the Commercial Invoice generator needs for one EXP: the trade's
// fields, its item lines, and the Swift Message / TT Voucher files of the EXP's collections
// (newest collection first; a settlement reads the files of the prepaid it came from).
func (s *Server) ciSources(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "id")
	if !ok {
		return
	}
	var out json.RawMessage
	err := s.tx(r, func(tx *sql.Tx) error {
		trade, err := db.One(r.Context(), tx, `select t.code, t.sales_contract_no, t.contract_date, t.exporter, t.exporter_address,
				t.importer_name, t.buyer_address, t.buyer_cr_no, t.buyer_vat_no, t.departure_port,
				t.country_of_destination, t.country_of_origin, t.shipping_mark, t.products
			from public.trades t join public.exps e on e.trade_id = t.id where e.id = $1`, id)
		if err != nil {
			return err
		}
		items, err := db.List(r.Context(), tx, `select i.description, i.quantity_kg from public.trade_items i
			join public.exps e on e.trade_id = i.trade_id where e.id = $1 order by i.sort_order`, id)
		if err != nil {
			return err
		}
		files, err := db.List(r.Context(), tx, `
			with cols as (
				select coalesce(case when c.kind = 'settlement' then c.source_collection_id end, c.id) as collection_id,
				       c.created_at
				from public.collection_exps ce
				join public.collections c on c.id = ce.collection_id
				where ce.exp_id = $1 and c.status::text <> 'rejected'
			), types(doc_type, rank) as (values ('Swift Message', 1), ('TT Voucher', 2))
			select f.path, f.name, f.doc_type
			from cols, types, lateral (
				select coalesce(d.file_path, a.file_path) as path, case when d.file_path is not null then d.file_name else a.file_name end as name,
				       types.doc_type
				from (select 1) one
				left join lateral (select file_path, file_name from public.documents
					where entity_type = 'collection' and entity_id = cols.collection_id and doc_type = types.doc_type
					  and file_path is not null limit 1) d on true
				left join lateral (select file_path, file_name from public.attachments
					where entity_type = 'collection' and entity_id = cols.collection_id and doc_type = types.doc_type
					  and file_path is not null order by created_at desc limit 1) a on true
			) f
			where f.path is not null
			order by cols.created_at desc, types.rank`, id)
		if err != nil {
			return err
		}
		out, err = json.Marshal(map[string]json.RawMessage{"trade": trade, "items": items, "tt_files": files})
		return err
	})
	s.respond(w, r, out, err)
}

// attachments lists files attached to records. ?entity_id=a,b
func (s *Server) attachments(w http.ResponseWriter, r *http.Request) {
	ids, ok := queryUUIDs(w, r, "entity_id")
	if !ok {
		return
	}
	var out json.RawMessage
	err := s.tx(r, func(tx *sql.Tx) (err error) {
		out, err = db.List(r.Context(), tx, "select * from public.attachments where entity_id = any($1::uuid[]) order by created_at", pq.Array(ids))
		return
	})
	s.respond(w, r, out, err)
}

// documents lists document slots with their versions. ?entity_type=collection&entity_id=a,b
func (s *Server) documents(w http.ResponseWriter, r *http.Request) {
	ids, ok := queryUUIDs(w, r, "entity_id")
	if !ok {
		return
	}
	et := r.URL.Query().Get("entity_type")
	var out json.RawMessage
	err := s.tx(r, func(tx *sql.Tx) (err error) {
		out, err = db.List(r.Context(), tx, `select d.*,
				coalesce((select json_agg(v) from public.document_versions v where v.document_id = d.id), '[]') as document_versions
			from public.documents d
			where d.entity_type = $1 and d.entity_id = any($2::uuid[]) order by d.sort_order`, et, pq.Array(ids))
		return
	})
	s.respond(w, r, out, err)
}

const collectionsSQL = `
select c.*,
  (select json_build_object('code', t.code, 'importer_name', t.importer_name) from public.trades t where t.id = c.trade_id) as trades,
  coalesce((select json_agg(json_build_object(
      'amount', ce.amount,
      'exps', (select json_build_object('id', e.id, 'code', e.code, 'exp_serial', e.exp_serial, 'exp_year', e.exp_year,
                 'exp_no', e.exp_no, 'awb_no', e.awb_no, 'amount', e.amount) from public.exps e where e.id = ce.exp_id)))
    from public.collection_exps ce where ce.collection_id = c.id), '[]') as collection_exps
from public.collections c
order by c.created_at desc`

const incentivesSQL = `
select i.*,
  coalesce((select json_agg(json_build_object(
      'amount', ie.amount,
      'exps', (select json_build_object('id', e.id, 'code', e.code, 'exp_serial', e.exp_serial, 'exp_year', e.exp_year,
                 'exp_no', e.exp_no, 'awb_no', e.awb_no,
                 'collection_exps', coalesce((select json_agg(json_build_object(
                     'collections', (select json_build_object('code', c.code, 'status', c.status) from public.collections c where c.id = ce.collection_id)))
                   from public.collection_exps ce where ce.exp_id = e.id), '[]'),
                 'trades', (select json_build_object('code', t.code, 'importer_name', t.importer_name) from public.trades t where t.id = e.trade_id))
               from public.exps e where e.id = ie.exp_id)))
    from public.incentive_exps ie where ie.incentive_id = i.id), '[]') as incentive_exps
from public.incentives i
order by i.created_at desc`

// helpers

func pathUUID(w http.ResponseWriter, r *http.Request, name string) (string, bool) {
	v := chi.URLParam(r, name)
	if !isUUID(v) {
		writeErr(w, http.StatusBadRequest, name+" must be a UUID")
		return "", false
	}
	return v, true
}

func queryUUIDs(w http.ResponseWriter, r *http.Request, name string) ([]string, bool) {
	ids := splitList(r.URL.Query().Get(name))
	if len(ids) == 0 {
		writeErr(w, http.StatusBadRequest, name+" is required")
		return nil, false
	}
	if len(ids) > 500 {
		writeErr(w, http.StatusBadRequest, "too many ids")
		return nil, false
	}
	for _, id := range ids {
		if !isUUID(id) {
			writeErr(w, http.StatusBadRequest, name+" must be a list of UUIDs")
			return nil, false
		}
	}
	return ids, true
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
				return false
			}
		}
	}
	return true
}

func badInput(msg string) error { return &db.InputError{Msg: msg} }
