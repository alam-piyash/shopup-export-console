package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func claims(role string, exp time.Duration) jwt.MapClaims {
	return jwt.MapClaims{"sub": "63fbdd93-e07a-48dd-9cfc-6dc89f8eaeeb", "role": role, "exp": time.Now().Add(exp).Unix()}
}

func TestHS256Secret(t *testing.T) {
	v := NewVerifier("http://127.0.0.1:1", "anon", "s3cret")
	good, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims("authenticated", time.Hour)).SignedString([]byte("s3cret"))
	if c, err := v.Verify(context.Background(), good); err != nil || c.Sub() == "" {
		t.Fatalf("valid token refused: %v", err)
	}
	expired, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims("authenticated", -time.Hour)).SignedString([]byte("s3cret"))
	wrongKey, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims("authenticated", time.Hour)).SignedString([]byte("other"))
	anonRole, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims("anon", time.Hour)).SignedString([]byte("s3cret"))
	for name, tok := range map[string]string{"expired": expired, "wrong key": wrongKey, "anon role": anonRole, "empty": ""} {
		if _, err := v.Verify(context.Background(), tok); err == nil {
			t.Errorf("%s token accepted", name)
		}
	}
}

func TestES256FromJWKS(t *testing.T) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	jwks := map[string]any{"keys": []any{map[string]any{
		"kid": "k1", "kty": "EC", "crv": "P-256", "alg": "ES256",
		"x": base64.RawURLEncoding.EncodeToString(key.X.FillBytes(make([]byte, 32))),
		"y": base64.RawURLEncoding.EncodeToString(key.Y.FillBytes(make([]byte, 32))),
	}}}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/.well-known/jwks.json" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(jwks)
	}))
	defer ts.Close()
	v := NewVerifier(ts.URL, "anon", "")
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims("authenticated", time.Hour))
	tok.Header["kid"] = "k1"
	s, _ := tok.SignedString(key)
	if _, err := v.Verify(context.Background(), s); err != nil {
		t.Fatalf("ES256 token refused: %v", err)
	}
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	bad, _ := tok.SignedString(other)
	if _, err := v.Verify(context.Background(), bad); err == nil {
		t.Fatal("token signed by another key accepted")
	}
}

func TestRemoteFallbackForHS256WithoutSecret(t *testing.T) {
	calls := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path == "/auth/v1/user" && r.Header.Get("Authorization") != "" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer ts.Close()
	v := NewVerifier(ts.URL, "anon", "")
	s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims("authenticated", time.Hour)).SignedString([]byte("unknown"))
	for i := 0; i < 3; i++ {
		if _, err := v.Verify(context.Background(), s); err != nil {
			t.Fatalf("remote check refused: %v", err)
		}
	}
	if calls != 1 {
		t.Fatalf("expected one call to Supabase Auth (then cache), got %d", calls)
	}
}
