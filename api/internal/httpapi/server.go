// Package httpapi is the REST API used by the ShopUp Export Console frontend.
package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/lib/pq"

	"github.com/alam-piyash/shopup-export-console/api/internal/auth"
	"github.com/alam-piyash/shopup-export-console/api/internal/db"
	"github.com/alam-piyash/shopup-export-console/api/internal/storage"
)

// Server holds the dependencies of the API.
type Server struct {
	DB       *db.DB
	Auth     *auth.Verifier
	Storage  *storage.Client
	Log      *slog.Logger
	maxBytes int64
}

type ctxKey int

const (
	claimsKey ctxKey = iota
	tokenKey
)

// Router builds every route. All routes live under /api.
func (s *Server) Router() http.Handler {
	s.maxBytes = 8 << 20
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, s.logRequests, middleware.Recoverer)
	r.Use(middleware.Timeout(55 * time.Second))

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", s.health)
		r.Group(func(r chi.Router) {
			r.Use(s.requireUser)
			s.readRoutes(r)
			s.writeRoutes(r)
			s.fileRoutes(r)
		})
		r.NotFound(func(w http.ResponseWriter, _ *http.Request) { writeErr(w, http.StatusNotFound, "Not found") })
	})
	return r
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.DB.Ping(ctx); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// requireUser verifies the access token and stores the claims on the request.
func (s *Server) requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := auth.BearerToken(r)
		claims, err := s.Auth.Verify(r.Context(), token)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
			return
		}
		ctx := context.WithValue(r.Context(), claimsKey, claims)
		ctx = context.WithValue(ctx, tokenKey, token)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func claimsOf(r *http.Request) auth.Claims { c, _ := r.Context().Value(claimsKey).(auth.Claims); return c }
func tokenOf(r *http.Request) string    { t, _ := r.Context().Value(tokenKey).(string); return t }

// tx runs fn as the signed-in user.
func (s *Server) tx(r *http.Request, fn func(tx *sql.Tx) error) error {
	return s.DB.Tx(r.Context(), claimsOf(r), fn)
}

// respond writes a JSON result, or the matching error.
func (s *Server) respond(w http.ResponseWriter, r *http.Request, out json.RawMessage, err error) {
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

// apiError is the error body. It keeps the shape of Supabase's REST errors
// (message, code, details, hint) so the frontend shows the same messages.
type apiError struct {
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
	Details string `json:"details,omitempty"`
	Hint    string `json:"hint,omitempty"`
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	var pqErr *pq.Error
	var inErr *db.InputError
	var stErr *storage.Error
	switch {
	case errors.As(err, &pqErr):
		status := http.StatusBadRequest
		switch {
		case pqErr.Code == "42501": // insufficient_privilege
			status = http.StatusForbidden
		case pqErr.Code == "23505": // unique_violation
			status = http.StatusConflict
		case pqErr.Code == "P0002" || pqErr.Code == "02000": // no_data_found
			status = http.StatusNotFound
		case pqErr.Code == "P0001", strings.HasPrefix(string(pqErr.Code), "22"), strings.HasPrefix(string(pqErr.Code), "23"):
			status = http.StatusBadRequest
		default:
			s.Log.Error("database error", "code", pqErr.Code, "msg", pqErr.Message, "path", r.URL.Path)
			writeJSON(w, http.StatusInternalServerError, apiError{Message: "Something went wrong. Please try again.", Code: string(pqErr.Code)})
			return
		}
		writeJSON(w, status, apiError{Message: pqErr.Message, Code: string(pqErr.Code), Details: pqErr.Detail, Hint: pqErr.Hint})
	case errors.As(err, &inErr):
		writeErr(w, http.StatusBadRequest, inErr.Msg)
	case errors.As(err, &stErr):
		writeErr(w, stErr.Status, stErr.Msg)
	case errors.Is(err, db.ErrNotFound):
		writeErr(w, http.StatusNotFound, "Not found")
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		writeErr(w, http.StatusGatewayTimeout, "The request took too long")
	default:
		s.Log.Error("request failed", "err", err, "path", r.URL.Path)
		writeErr(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, apiError{Message: msg})
}

// body decodes a JSON object body (an empty body is an empty object).
func (s *Server) body(w http.ResponseWriter, r *http.Request) (map[string]any, error) {
	out := map[string]any{}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, s.maxBytes))
	dec.UseNumber()
	if err := dec.Decode(&out); err != nil && !errors.Is(err, io.EOF) {
		return nil, &db.InputError{Msg: "request body must be a JSON object"}
	}
	return out, nil
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		s.Log.Info("request", "method", r.Method, "path", r.URL.Path, "status", ww.Status(), "ms", time.Since(start).Milliseconds())
	})
}
