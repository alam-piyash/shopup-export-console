// Package auth verifies Supabase access tokens.
//
// The frontend signs in with Supabase Auth (Google) and sends the access token as
// "Authorization: Bearer <token>". The API verifies it in this order:
//  1. Asymmetric keys (ES256 / RS256) published at <SUPABASE_URL>/auth/v1/.well-known/jwks.json
//  2. The legacy HS256 secret, when SUPABASE_JWT_SECRET is set
//  3. Otherwise it asks Supabase Auth (/auth/v1/user) and caches the answer until the token expires
//
// The verified claims are passed to Postgres, so auth.uid() and every RLS policy and
// database function keep working exactly as they did with direct Supabase calls.
package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims are the verified JWT claims of the signed-in user.
type Claims map[string]any

// Sub is the user id.
func (c Claims) Sub() string { s, _ := c["sub"].(string); return s }

// Email is the user's email address.
func (c Claims) Email() string { s, _ := c["email"].(string); return s }

// ErrUnauthorized means the token is missing, invalid or expired.
var ErrUnauthorized = errors.New("not signed in or session expired")

// Verifier checks access tokens.
type Verifier struct {
	supabaseURL string
	anonKey     string
	secret      []byte
	client      *http.Client

	mu        sync.Mutex
	keys      map[string]any // kid -> public key
	keysAt    time.Time
	userCache map[string]cached // sha256(token) -> claims
}

type cached struct {
	claims Claims
	until  time.Time
}

// NewVerifier builds a verifier for one Supabase project.
func NewVerifier(supabaseURL, anonKey, secret string) *Verifier {
	return &Verifier{
		supabaseURL: supabaseURL,
		anonKey:     anonKey,
		secret:      []byte(secret),
		client:      &http.Client{Timeout: 8 * time.Second},
		keys:        map[string]any{},
		userCache:   map[string]cached{},
	}
}

// Verify returns the claims of a valid token.
func (v *Verifier) Verify(ctx context.Context, token string) (Claims, error) {
	if token == "" {
		return nil, ErrUnauthorized
	}
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"ES256", "RS256", "HS256"}),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(30*time.Second),
	)
	claims := jwt.MapClaims{}
	_, err := parser.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		switch t.Method.Alg() {
		case "HS256":
			if len(v.secret) == 0 {
				return nil, errNeedRemote
			}
			return v.secret, nil
		default:
			kid, _ := t.Header["kid"].(string)
			return v.key(ctx, kid)
		}
	})
	if errors.Is(err, errNeedRemote) {
		return v.remote(ctx, token)
	}
	if err != nil {
		return nil, ErrUnauthorized
	}
	if role, _ := claims["role"].(string); role != "authenticated" {
		return nil, ErrUnauthorized
	}
	return Claims(claims), nil
}

var errNeedRemote = errors.New("verify with Supabase Auth")

// key returns the public key for a key id, refreshing the JWKS when the id is unknown.
func (v *Verifier) key(ctx context.Context, kid string) (any, error) {
	v.mu.Lock()
	k, ok := v.keys[kid]
	stale := time.Since(v.keysAt) > 10*time.Minute
	v.mu.Unlock()
	if ok && !stale {
		return k, nil
	}
	if err := v.loadKeys(ctx); err != nil {
		if ok {
			return k, nil
		}
		return nil, err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if k, ok := v.keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("unknown signing key %q", kid)
}

func (v *Verifier) loadKeys(ctx context.Context) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, v.supabaseURL+"/auth/v1/.well-known/jwks.json", nil)
	req.Header.Set("apikey", v.anonKey)
	res, err := v.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks: status %d", res.StatusCode)
	}
	var doc struct {
		Keys []struct {
			Kid, Kty, Crv, X, Y, N, E string
		} `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&doc); err != nil {
		return err
	}
	keys := map[string]any{}
	for _, k := range doc.Keys {
		switch k.Kty {
		case "EC":
			if k.Crv != "P-256" {
				continue
			}
			x, err1 := b64(k.X)
			y, err2 := b64(k.Y)
			if err1 != nil || err2 != nil {
				continue
			}
			keys[k.Kid] = &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
		case "RSA":
			n, err1 := b64(k.N)
			e, err2 := b64(k.E)
			if err1 != nil || err2 != nil {
				continue
			}
			keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
		}
	}
	v.mu.Lock()
	v.keys, v.keysAt = keys, time.Now()
	v.mu.Unlock()
	return nil
}

// remote asks Supabase Auth whether the token is valid (used for HS256 tokens without a local secret).
func (v *Verifier) remote(ctx context.Context, token string) (Claims, error) {
	sum := sha256.Sum256([]byte(token))
	key := hex.EncodeToString(sum[:])
	v.mu.Lock()
	if c, ok := v.userCache[key]; ok && time.Now().Before(c.until) {
		v.mu.Unlock()
		return c.claims, nil
	}
	v.mu.Unlock()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, v.supabaseURL+"/auth/v1/user", nil)
	req.Header.Set("apikey", v.anonKey)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := v.client.Do(req)
	if err != nil {
		return nil, err
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, ErrUnauthorized
	}
	// Supabase confirmed the token, so its payload can be read as is.
	claims := jwt.MapClaims{}
	if _, _, err := jwt.NewParser().ParseUnverified(token, claims); err != nil {
		return nil, ErrUnauthorized
	}
	if role, _ := claims["role"].(string); role != "authenticated" {
		return nil, ErrUnauthorized
	}
	until := time.Now().Add(5 * time.Minute)
	if exp, err := claims.GetExpirationTime(); err == nil && exp != nil && exp.Before(until) {
		until = exp.Time
	}
	v.mu.Lock()
	v.userCache[key] = cached{claims: Claims(claims), until: until}
	if len(v.userCache) > 5000 { // keep memory bounded
		for k, c := range v.userCache {
			if time.Now().After(c.until) {
				delete(v.userCache, k)
			}
		}
	}
	v.mu.Unlock()
	return Claims(claims), nil
}

func b64(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "=")) }

// BearerToken reads the token from the Authorization header.
func BearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}
