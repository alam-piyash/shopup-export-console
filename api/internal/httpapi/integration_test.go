package httpapi_test

// End-to-end test of the API against a real Postgres database with the project's migrations.
// It is skipped unless TEST_DATABASE_URL is set, for example:
//
//	TEST_DATABASE_URL='postgres://postgres@localhost/export_local?sslmode=disable' go test ./...
//
// The database needs a signed-in admin in auth.users (see README, "Local test database").

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/alam-piyash/shopup-export-console/api/internal/auth"
	"github.com/alam-piyash/shopup-export-console/api/internal/db"
	"github.com/alam-piyash/shopup-export-console/api/internal/httpapi"
	"github.com/alam-piyash/shopup-export-console/api/internal/storage"
)

const (
	secret  = "local-test-secret"
	adminID = "63fbdd93-e07a-48dd-9cfc-6dc89f8eaeeb"
)

type client struct {
	t     *testing.T
	base  string
	token string
}

func token(t *testing.T, sub, email string) string {
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": sub, "email": email, "role": "authenticated", "aud": "authenticated",
		"exp": time.Now().Add(time.Hour).Unix(), "user_metadata": map[string]any{"full_name": "Test User"},
	})
	s, err := tok.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// do sends a request and decodes the JSON answer into out (when out is not nil).
func (c client) do(method, path string, body any, out any) (int, string) {
	c.t.Helper()
	var rdr io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rdr = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, c.base+path, rdr)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if out != nil && res.StatusCode < 300 {
		if err := json.Unmarshal(raw, out); err != nil {
			c.t.Fatalf("%s %s: decode %q: %v", method, path, raw, err)
		}
	}
	return res.StatusCode, string(raw)
}

// must fails the test unless the request succeeds.
func (c client) must(method, path string, body any, out any) {
	c.t.Helper()
	if code, raw := c.do(method, path, body, out); code >= 300 {
		c.t.Fatalf("%s %s -> %d %s", method, path, code, raw)
	}
}

// refused expects an error status and checks that the message mentions want.
func (c client) refused(method, path string, body any, want string) {
	c.t.Helper()
	code, raw := c.do(method, path, body, nil)
	if code < 400 || !strings.Contains(strings.ToLower(raw), strings.ToLower(want)) {
		c.t.Fatalf("%s %s: expected refusal mentioning %q, got %d %s", method, path, want, code, raw)
	}
}

func TestEndToEnd(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	database, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	srv := &httpapi.Server{
		DB:      database,
		Auth:    auth.NewVerifier("http://127.0.0.1:1", "anon", secret),
		Storage: storage.New("http://127.0.0.1:1", "anon", "documents"),
		Log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	ts := httptest.NewServer(srv.Router())
	defer ts.Close()

	admin := client{t, ts.URL, token(t, adminID, "tasnim.piyash@shopup.org")}
	anon := client{t, ts.URL, ""}
	run := fmt.Sprintf("%d", time.Now().UnixNano()%1_000_000)
	file := map[string]any{"path": "tests/" + run + "/sample.pdf", "name": "sample.pdf", "size": 1000}

	// health and auth
	admin.must("GET", "/api/health", nil, nil)
	if code, _ := anon.do("GET", "/api/trades", nil, nil); code != 401 {
		t.Fatalf("no token: want 401, got %d", code)
	}
	if code, _ := (client{t, ts.URL, "not-a-token"}).do("GET", "/api/trades", nil, nil); code != 401 {
		t.Fatalf("bad token: want 401, got %d", code)
	}
	var me map[string]any
	admin.must("GET", "/api/me", nil, &me)
	if me["role"] != "admin" || me["email"] != "tasnim.piyash@shopup.org" {
		t.Fatalf("me: %v", me)
	}

	// masters
	var profiles []map[string]any
	admin.must("GET", "/api/company-profiles", nil, &profiles)
	var buyerID string
	admin.must("POST", "/api/buyers", map[string]any{"name": "API Test Buyer " + run, "country": "KSA", "address": "Riyadh",
		"notify_parties": []any{map[string]any{"name": "Notify Ltd", "address": "Dubai"}}}, &buyerID)
	admin.refused("POST", "/api/buyers", map[string]any{"name": "api test buyer " + run}, "already exists")

	// trade
	sc := "API/SU/" + run
	tradeData := map[string]any{"exporter": "Unicorn Distribution Limited", "importer_name": "API Test Buyer " + run, "importer_country": "KSA",
		"sales_contract_no": sc, "contract_date": time.Now().AddDate(0, 0, -5).Format("2006-01-02"),
		"shipment_deadline": time.Now().AddDate(0, 0, 40).Format("2006-01-02"), "expiry_date": time.Now().AddDate(0, 0, 120).Format("2006-01-02"),
		"carriage_by": "Air", "payment_type": "Advance TT", "tolerance_pct": "10", "buyer_id": buyerID, "country_of_destination": "KSA"}
	items := []any{
		map[string]any{"description": "VEGETABLE", "hs_code": "0711 90 00", "incoterm": "CFR", "quantity_kg": "10000", "rate_per_kg": "2.5", "rate_usd_per_kg": "2.5"},
		map[string]any{"description": "FRESH BETEL LEAVES", "hs_code": "1404 90 92", "incoterm": "CFR", "quantity_kg": "2000", "rate_per_kg": "5.5", "rate_usd_per_kg": "5.5"},
	}
	var tradeID string
	admin.must("POST", "/api/trades", map[string]any{"data": tradeData, "items": items, "file": nil}, &tradeID)
	admin.refused("POST", "/api/trades", map[string]any{"data": tradeData, "items": items, "file": nil}, "already exists")
	admin.refused("POST", "/api/trades", map[string]any{"data": tradeData, "bogus": 1}, "unknown field")

	var detail struct {
		Trade map[string]any   `json:"trade"`
		Exps  []map[string]any `json:"exps"`
	}
	admin.must("GET", "/api/trades/"+tradeID, nil, &detail)
	if detail.Trade["status"] != "pending_approval" && detail.Trade["status"] != "pending" {
		t.Logf("new trade status: %v", detail.Trade["status"])
	}
	contract := detail.Trade["contract_amount"].(float64)
	if contract != 36000 {
		t.Fatalf("contract amount: want 36000, got %v", contract)
	}
	admin.must("POST", "/api/trades/"+tradeID+"/approve", nil, nil)

	var pendingList []map[string]any
	admin.must("GET", "/api/trades?status=active,revision_pending", nil, &pendingList)
	if !containsID(pendingList, tradeID) {
		t.Fatal("approved trade missing from active list")
	}

	// EXP needs a signed contract first
	fields := map[string]any{"exp_serial": run, "exp_year": "2026", "entry_date": "2026-11-01", "hs_code": "0711 90 00", "unit_iso": "KGM",
		"incoterm": "CFR", "quantity": "4000", "freight": "500", "dest_port": "RUH", "shipment_date": "2026-11-05", "dup_flag": "Y",
		"dup_date": "2026-11-06", "invoice_no": "INV-" + run, "invoice_date": "2026-11-05", "carrier": "EK", "awb_no": "176-" + run,
		"trans_doc_date": "2026-11-05", "custom_code": "301", "export_bill_no": "EB-" + run, "export_bill_date": "2026-11-07",
		"shipment_id": "SH-" + run}
	admin.refused("POST", "/api/exps", map[string]any{"trade": tradeID, "amount": 10000, "advance": false, "fields": fields}, "signed sales contract")

	var verID string
	admin.must("POST", "/api/trades/"+tradeID+"/contract-versions",
		map[string]any{"file": file, "source": "uploaded", "note": "Signed copy", "stage": "Signed", "submitted_on": time.Now().Format("2006-01-02")}, &verID)
	var docs []map[string]any
	admin.must("GET", "/api/trades/"+tradeID+"/contract-documents?source=uploaded", nil, &docs)
	if len(docs) != 1 || docs[0]["id"] != verID {
		t.Fatalf("contract documents: %v", docs)
	}
	admin.must("POST", "/api/contract-documents/"+verID+"/sign", nil, nil)

	// EXP
	var expID string
	admin.must("POST", "/api/exps", map[string]any{"trade": tradeID, "amount": 10000, "advance": false, "fields": fields}, &expID)
	admin.refused("POST", "/api/exps", map[string]any{"trade": tradeID, "amount": 10000, "advance": false, "fields": fields}, "already exists")
	admin.refused("POST", "/api/exps", map[string]any{"trade": tradeID, "amount": 999999, "advance": true, "fields": map[string]any{}}, "exceeds")
	admin.must("PATCH", "/api/exps/"+expID, map[string]any{"amount": nil, "fields": map[string]any{"carrier": "EK585"}}, nil)

	var exp struct {
		Exp      map[string]any   `json:"exp"`
		Docs     []map[string]any `json:"docs"`
		Trade    map[string]any   `json:"trade"`
		Versions []map[string]any `json:"versions"`
	}
	admin.must("GET", "/api/exps/"+expID, nil, &exp)
	if len(exp.Docs) != 8 || exp.Exp["carrier"] != "EK585" || exp.Trade == nil {
		t.Fatalf("exp detail: %d docs, carrier %v", len(exp.Docs), exp.Exp["carrier"])
	}
	var tradeExps []map[string]any
	admin.must("GET", "/api/exps?trade_id="+tradeID+"&order=asc", nil, &tradeExps)
	if len(tradeExps) != 1 {
		t.Fatalf("exps for trade: %d", len(tradeExps))
	}

	// all 8 documents final closes the EXP
	for _, d := range exp.Docs {
		id := d["id"].(string)
		admin.must("POST", "/api/exp-documents/"+id+"/versions", map[string]any{"file": file, "stage": "Submitted", "submitted_on": "2026-11-08"}, nil)
		admin.must("POST", "/api/exp-documents/"+id+"/finalize", nil, nil)
	}
	admin.must("GET", "/api/exps/"+expID, nil, &exp)
	if exp.Exp["status"] != "closed" || len(exp.Versions) != 8 {
		t.Fatalf("exp after documents: status %v, %d versions", exp.Exp["status"], len(exp.Versions))
	}

	// follow-up
	admin.must("POST", "/api/trades/"+tradeID+"/followups/1/done", map[string]any{"note": "Checked"}, nil)
	var followups []map[string]any
	admin.must("GET", "/api/trades/"+tradeID+"/followups", nil, &followups)
	if len(followups) != 1 {
		t.Fatalf("followups: %v", followups)
	}

	// collection
	swift := map[string]any{"doc_type": "Swift Message", "path": file["path"], "name": "swift.pdf", "size": 900}
	var colID string
	admin.must("POST", "/api/collections", map[string]any{"trade": tradeID, "amount": 10000, "bank_ref": "TT-" + run, "prepaid": false,
		"lines": []any{map[string]any{"exp_id": expID, "amount": 10000}}, "docs": []any{swift}}, &colID)
	var cols []map[string]any
	admin.must("GET", "/api/collections", nil, &cols)
	col := find(cols, colID)
	if col == nil || len(col["collection_exps"].([]any)) != 1 || col["trades"].(map[string]any)["code"] == nil {
		t.Fatalf("collection list entry: %v", col)
	}
	var colDocs []map[string]any
	admin.must("GET", "/api/documents?entity_type=collection&entity_id="+colID, nil, &colDocs)
	if len(colDocs) == 0 {
		t.Fatal("collection has no document cards")
	}
	var ci struct {
		Trade   map[string]any   `json:"trade"`
		Items   []map[string]any `json:"items"`
		TTFiles []map[string]any `json:"tt_files"`
	}
	admin.must("GET", "/api/exps/"+expID+"/ci-sources", nil, &ci)
	if ci.Trade["sales_contract_no"] != sc || len(ci.Items) != 2 || len(ci.TTFiles) == 0 || ci.TTFiles[0]["doc_type"] != "Swift Message" {
		t.Fatalf("ci sources: %+v", ci)
	}
	var counts map[string]any
	admin.must("GET", "/api/pending-counts", nil, &counts)
	if counts["collections"].(float64) < 1 {
		t.Fatalf("pending counts: %v", counts)
	}
	admin.must("POST", "/api/collections/"+colID+"/decide", map[string]any{"approve": true, "reason": ""}, nil)

	// incentive
	var eligible []map[string]any
	admin.must("GET", "/api/exps?incentive_eligible=true&order=asc", nil, &eligible)
	if !containsID(eligible, expID) {
		t.Fatal("collected EXP not eligible for incentive")
	}
	var incDocs []any
	for _, d := range []string{"Ka Form", "Association Certificate", "Forwarding Letter", "Overdue Certificate", "Undertakings"} {
		incDocs = append(incDocs, map[string]any{"doc_type": d, "path": file["path"], "name": d + ".pdf", "size": 500})
	}
	var incID string
	admin.must("POST", "/api/incentives", map[string]any{"exp_ids": []any{expID}, "net": 9500, "freight": 500, "pct": 10, "docs": incDocs}, &incID)
	var incs []map[string]any
	admin.must("GET", "/api/incentives", nil, &incs)
	if inc := find(incs, incID); inc == nil || len(inc["incentive_exps"].([]any)) != 1 {
		t.Fatalf("incentive list entry: %v", inc)
	}
	admin.must("POST", "/api/incentives/"+incID+"/decide", map[string]any{"approve": true, "reason": ""}, nil)

	// reads used across the app
	var activity []map[string]any
	admin.must("GET", "/api/activity?limit=50&trade_id="+tradeID, nil, &activity)
	if len(activity) < 8 {
		t.Fatalf("activity: %d entries", len(activity))
	}
	var access map[string][]any
	admin.must("GET", "/api/access", nil, &access)
	if len(access["profiles"]) == 0 || len(access["roles"]) == 0 {
		t.Fatalf("access: %v", access)
	}
	for _, p := range []string{"/api/trades", "/api/exps", "/api/profiles", "/api/buyers", "/api/products", "/api/demo-count",
		"/api/trades/" + tradeID + "/items", "/api/trades/" + tradeID + "/amendments", "/api/trades/" + tradeID + "/prepaids",
		"/api/exps/" + expID + "/amount-changes", "/api/collections/" + colID, "/api/attachments?entity_id=" + tradeID} {
		admin.must("GET", p, nil, nil)
	}

	// someone signed in without a role sees nothing and cannot write
	stranger := client{t, ts.URL, token(t, "11111111-2222-4333-8444-555555555555", "someone@shopup.org")}
	var none []map[string]any
	stranger.must("GET", "/api/trades", nil, &none)
	if len(none) != 0 {
		t.Fatalf("user without a role saw %d trades", len(none))
	}
	if code, _ := stranger.do("POST", "/api/trades/"+tradeID+"/close", nil, nil); code < 400 {
		t.Fatal("user without a role could close a trade")
	}

	// input checks
	if code, _ := admin.do("GET", "/api/trades/not-a-uuid", nil, nil); code != 400 {
		t.Fatalf("bad id: want 400, got %d", code)
	}
	if code, _ := admin.do("GET", "/api/nope", nil, nil); code != 404 {
		t.Fatalf("unknown route: want 404, got %d", code)
	}
}

func containsID(rows []map[string]any, id string) bool { return find(rows, id) != nil }

func find(rows []map[string]any, id string) map[string]any {
	for _, r := range rows {
		if r["id"] == id {
			return r
		}
	}
	return nil
}
