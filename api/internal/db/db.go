// Package db runs every request inside a Postgres transaction that acts as the signed-in user.
//
// Each transaction sets the role to "authenticated" and passes the user's JWT claims in
// request.jwt.claims, the same way Supabase's REST layer does. That keeps auth.uid(),
// the RLS policies and the security-definer business functions working unchanged.
package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/alam-piyash/shopup-export-console/api/internal/auth"
	"github.com/lib/pq" // Postgres driver
)

// DB wraps the connection pool and the cached signatures of the business functions.
type DB struct {
	pool *sql.DB
	fns  map[string]Function
}

// Function is the signature of one callable database function.
type Function struct {
	Name string
	Args []Arg
}

// Arg is one named argument of a database function.
type Arg struct {
	Name       string
	Type       string // Postgres type, for example uuid, jsonb, uuid[]
	HasDefault bool
}

// Open connects to Postgres and loads the function signatures.
func Open(ctx context.Context, url string) (*DB, error) {
	pool, err := sql.Open("postgres", url)
	if err != nil {
		return nil, redact(err, url)
	}
	// Serverless instances stay small; the Supabase pooler does the real pooling.
	pool.SetMaxOpenConns(5)
	pool.SetMaxIdleConns(2)
	pool.SetConnMaxIdleTime(60 * time.Second)
	if err := pool.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("connect to database: %w", redact(err, url))
	}
	d := &DB{pool: pool}
	if err := d.loadFunctions(ctx); err != nil {
		return nil, err
	}
	return d, nil
}

// Close closes the pool.
func (d *DB) Close() error { return d.pool.Close() }

// Ping checks the connection.
func (d *DB) Ping(ctx context.Context) error { return d.pool.PingContext(ctx) }

// loadFunctions reads every public function that signed-in users may execute.
func (d *DB) loadFunctions(ctx context.Context) error {
	rows, err := d.pool.QueryContext(ctx, `
		select p.proname,
		       coalesce(p.proargnames, '{}'::text[]),
		       array(select format_type(t, null) from unnest(p.proargtypes) t),
		       p.pronargs, p.pronargdefaults
		from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where n.nspname = 'public'
		  and p.prokind = 'f'
		  and p.prorettype <> 'trigger'::regtype
		  and has_function_privilege('authenticated', p.oid, 'execute')`)
	if err != nil {
		return fmt.Errorf("load functions: %w", err)
	}
	defer rows.Close()
	fns := map[string]Function{}
	for rows.Next() {
		var name string
		var names, types pq.StringArray
		var nargs, ndefaults int
		if err := rows.Scan(&name, &names, &types, &nargs, &ndefaults); err != nil {
			return err
		}
		f := Function{Name: name}
		for i := 0; i < nargs; i++ {
			a := Arg{Type: types[i], HasDefault: i >= nargs-ndefaults}
			if i < len(names) {
				a.Name = names[i]
			}
			f.Args = append(f.Args, a)
		}
		fns[name] = f
	}
	d.fns = fns
	return rows.Err()
}

// Function returns a cached signature.
func (d *DB) Function(name string) (Function, bool) { f, ok := d.fns[name]; return f, ok }

// Tx runs fn in a transaction that acts as the given user.
func (d *DB) Tx(ctx context.Context, claims auth.Claims, fn func(tx *sql.Tx) error) error {
	tx, err := d.pool.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // no-op after commit
	raw, _ := json.Marshal(claims)
	if _, err := tx.ExecContext(ctx,
		`select set_config('role', 'authenticated', true),
		        set_config('request.jwt.claims', $1, true),
		        set_config('request.jwt.claim.sub', $2, true)`,
		string(raw), claims.Sub()); err != nil {
		return fmt.Errorf("set user context: %w", err)
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// List returns the rows of a query as a JSON array ("[]" when there are none).
func List(ctx context.Context, tx *sql.Tx, query string, args ...any) (json.RawMessage, error) {
	var out []byte
	err := tx.QueryRowContext(ctx, "select coalesce(json_agg(x), '[]'::json) from ("+query+") x", args...).Scan(&out)
	return out, err
}

// ErrNotFound means a single-row query returned nothing.
var ErrNotFound = errors.New("not found")

// One returns the first row of a query as a JSON object, or ErrNotFound.
func One(ctx context.Context, tx *sql.Tx, query string, args ...any) (json.RawMessage, error) {
	var out []byte
	err := tx.QueryRowContext(ctx, "select row_to_json(x) from ("+query+") x limit 1", args...).Scan(&out)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && out == nil) {
		return nil, ErrNotFound
	}
	return out, err
}

// Value returns a single JSON value (for example the result of a function).
func Value(ctx context.Context, tx *sql.Tx, query string, args ...any) (json.RawMessage, error) {
	var out []byte
	err := tx.QueryRowContext(ctx, "select to_json(("+query+"))", args...).Scan(&out)
	if out == nil {
		out = []byte("null")
	}
	return out, err
}

// Call runs a business function with named arguments and returns its result as JSON.
// Arguments that are not supplied are left to their default, or passed as null.
func (d *DB) Call(ctx context.Context, tx *sql.Tx, name string, args map[string]any) (json.RawMessage, error) {
	f, ok := d.fns[name]
	if !ok {
		return nil, fmt.Errorf("unknown function %s", name)
	}
	var parts []string
	var vals []any
	for _, a := range f.Args {
		v, supplied := args[a.Name]
		if !supplied {
			if a.HasDefault {
				continue
			}
			parts = append(parts, fmt.Sprintf("%s => null", quoteIdent(a.Name)))
			continue
		}
		expr, val, err := param(len(vals)+1, a.Type, v)
		if err != nil {
			return nil, &InputError{Msg: fmt.Sprintf("%s: %v", strings.TrimPrefix(a.Name, "p_"), err)}
		}
		if val == nil {
			parts = append(parts, fmt.Sprintf("%s => null", quoteIdent(a.Name)))
			continue
		}
		vals = append(vals, val)
		parts = append(parts, fmt.Sprintf("%s => %s", quoteIdent(a.Name), expr))
	}
	q := fmt.Sprintf("select to_jsonb(public.%s(%s))", quoteIdent(f.Name), strings.Join(parts, ", "))
	var out []byte
	if err := tx.QueryRowContext(ctx, q, vals...).Scan(&out); err != nil {
		return nil, err
	}
	if out == nil {
		out = []byte("null")
	}
	return out, nil
}

// InputError is a bad argument from the caller.
type InputError struct{ Msg string }

func (e *InputError) Error() string { return e.Msg }

// param turns a JSON value into a query parameter with the right cast.
func param(n int, typ string, v any) (string, any, error) {
	if v == nil {
		return "", nil, nil
	}
	ph := "$" + strconv.Itoa(n)
	switch {
	case typ == "jsonb" || typ == "json":
		raw, err := json.Marshal(v)
		if err != nil {
			return "", nil, err
		}
		return ph + "::" + typ, string(raw), nil
	case strings.HasSuffix(typ, "[]"):
		if _, ok := v.([]any); !ok {
			return "", nil, errors.New("expected a list")
		}
		raw, _ := json.Marshal(v)
		elem := strings.TrimSuffix(typ, "[]")
		return fmt.Sprintf("array(select jsonb_array_elements_text(%s::jsonb))::%s[]", ph, elem), string(raw), nil
	}
	switch x := v.(type) {
	case string:
		return ph + "::" + typ, x, nil
	case bool:
		return ph + "::" + typ, strconv.FormatBool(x), nil
	case float64:
		return ph + "::" + typ, strconv.FormatFloat(x, 'f', -1, 64), nil
	case json.Number:
		return ph + "::" + typ, x.String(), nil
	default:
		return "", nil, fmt.Errorf("unsupported value for %s", typ)
	}
}

// redact keeps the connection string (and its password) out of error messages and logs.
func redact(err error, url string) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if url != "" && strings.Contains(msg, url) {
		msg = strings.ReplaceAll(msg, url, "[DATABASE_URL]")
	}
	// URL parse errors quote the connection string; never pass those through.
	if strings.Contains(msg, "://") {
		return errors.New("DATABASE_URL is not a valid connection string (check that the password has no brackets or unencoded special characters)")
	}
	return errors.New(msg)
}

func quoteIdent(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }
