package httpapi

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

// Every write calls one business function in Postgres. The functions check the user's
// role, validate the input, apply the rule (EXP numbering, locks, allocation, approvals)
// and write the activity log, so the API layer stays thin.
//
// Body fields are the function's arguments without the "p_" prefix, for example
// POST /api/trades/{id}/reject {"reason": "..."} calls reject_trade(p_id => {id}, p_reason => '...').

type action struct {
	method string
	path   string
	fn     string
	// path parameter name -> function argument
	params map[string]string
	// when set, the whole JSON body is passed as this one argument (for save_buyer(p jsonb) and similar)
	wholeBody string
}

var actions = []action{
	// trades and sales contracts
	{"POST", "/trades", "create_trade", nil, ""},
	{"POST", "/trades/{id}/approve", "approve_trade", map[string]string{"id": "p_id"}, ""},
	{"POST", "/trades/{id}/reject", "reject_trade", map[string]string{"id": "p_id"}, ""},
	{"POST", "/trades/{id}/close", "close_trade", map[string]string{"id": "p_id"}, ""},
	{"POST", "/trades/{id}/amendments", "request_amendment", map[string]string{"id": "p_trade"}, ""},
	{"POST", "/amendments/{id}/approve", "approve_amendment", map[string]string{"id": "p_id"}, ""},
	{"POST", "/amendments/{id}/reject", "reject_amendment", map[string]string{"id": "p_id"}, ""},
	{"POST", "/amendments/{id}/withdraw", "withdraw_amendment", map[string]string{"id": "p_id"}, ""},
	{"POST", "/trades/{id}/contract-versions", "add_contract_version", map[string]string{"id": "p_trade"}, ""},
	{"POST", "/contract-documents/{id}/sign", "mark_contract_signed", map[string]string{"id": "p_id"}, ""},
	{"POST", "/trades/{id}/followups/{checkpoint}/done", "mark_followup_done", map[string]string{"id": "p_trade", "checkpoint": "p_checkpoint"}, ""},

	// EXPs
	{"POST", "/exps", "create_exp", nil, ""},
	{"PATCH", "/exps/{id}", "update_exp", map[string]string{"id": "p_id"}, ""},
	{"POST", "/exps/bulk", "bulk_exps", nil, ""},
	{"POST", "/exps/{id}/amount-changes", "request_exp_amount_change", map[string]string{"id": "p_exp"}, ""},
	{"POST", "/amount-changes/{id}/decide", "decide_exp_amount_change", map[string]string{"id": "p_id"}, ""},
	{"POST", "/amount-changes/{id}/withdraw", "withdraw_exp_amount_change", map[string]string{"id": "p_id"}, ""},
	{"POST", "/exp-documents/{id}/versions", "upload_exp_document", map[string]string{"id": "p_doc"}, ""},
	{"POST", "/exp-documents/{id}/finalize", "finalize_exp_document", map[string]string{"id": "p_doc"}, ""},

	// documents on collections, incentives, amendments and amount changes
	{"POST", "/documents/{id}/versions", "add_document_version", map[string]string{"id": "p_doc"}, ""},
	{"POST", "/documents/{id}/finalize", "finalize_document", map[string]string{"id": "p_doc"}, ""},

	// collections and incentives
	{"POST", "/collections", "submit_collection", nil, ""},
	{"POST", "/collections/{id}/settle", "settle_prepaid", map[string]string{"id": "p_source"}, ""},
	{"POST", "/collections/{id}/decide", "decide_collection", map[string]string{"id": "p_id"}, ""},
	{"POST", "/incentives", "create_incentive", nil, ""},
	{"POST", "/incentives/{id}/decide", "decide_incentive", map[string]string{"id": "p_id"}, ""},

	// masters
	{"POST", "/buyers", "save_buyer", nil, "p"},
	{"POST", "/company-profiles", "save_company_profile", nil, "p"},
	{"POST", "/products", "save_product", nil, "p"},

	// access (admin)
	{"POST", "/access/preassignments", "preassign_role", nil, ""},
	{"DELETE", "/access/preassignments/{email}", "delete_preassignment", map[string]string{"email": "p_email"}, ""},
	{"PUT", "/access/users/{id}/role", "set_user_role", map[string]string{"id": "p_user"}, ""},
	{"DELETE", "/access/users/{id}", "remove_access", map[string]string{"id": "p_user"}, ""},
	{"DELETE", "/demo-data", "remove_demo_data", nil, ""},
}

func (s *Server) writeRoutes(r chi.Router) {
	for _, a := range actions {
		r.Method(a.method, a.path, s.callAction(a))
	}
}

// Actions lists the write routes (used by tests and the API reference).
func Actions() []struct{ Method, Path, Fn string } {
	out := make([]struct{ Method, Path, Fn string }, 0, len(actions))
	for _, a := range actions {
		out = append(out, struct{ Method, Path, Fn string }{a.method, "/api" + a.path, a.fn})
	}
	return out
}

func (s *Server) callAction(a action) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f, ok := s.DB.Function(a.fn)
		if !ok {
			s.Log.Error("function missing in database", "fn", a.fn)
			writeErr(w, http.StatusNotImplemented, "This action is not available")
			return
		}
		body, err := s.body(w, r)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		args := map[string]any{}
		if a.wholeBody != "" {
			args[a.wholeBody] = body
		} else {
			known := map[string]bool{}
			for _, arg := range f.Args {
				known[arg.Name] = true
			}
			for k, v := range body {
				switch {
				case known["p_"+k]:
					args["p_"+k] = v
				case known[k] && strings.HasPrefix(k, "p_"):
					args[k] = v
				default:
					writeErr(w, http.StatusBadRequest, "unknown field: "+k)
					return
				}
			}
		}
		for param, arg := range a.params {
			v := chi.URLParam(r, param)
			if strings.HasSuffix(param, "id") && !isUUID(v) {
				writeErr(w, http.StatusBadRequest, param+" must be a UUID")
				return
			}
			if param == "checkpoint" {
				if _, err := strconv.Atoi(v); err != nil {
					writeErr(w, http.StatusBadRequest, "checkpoint must be a number")
					return
				}
			}
			args[arg] = v
		}
		var out json.RawMessage
		err = s.tx(r, func(tx *sql.Tx) (err error) { out, err = s.DB.Call(r.Context(), tx, a.fn, args); return })
		s.respond(w, r, out, err)
	}
}

