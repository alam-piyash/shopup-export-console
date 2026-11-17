// Package config reads the API settings from environment variables.
package config

import (
	"errors"
	"os"
	"strings"
)

// Config holds every setting the API needs. All values come from the environment.
type Config struct {
	// Port the HTTP server listens on (Vercel sets PORT).
	Port string
	// DatabaseURL is the Postgres connection string (Supabase pooler, transaction mode).
	DatabaseURL string
	// SupabaseURL is the project URL, for example https://<ref>.supabase.co.
	SupabaseURL string
	// SupabaseAnonKey is the public anon key, used as the apikey header for Auth and Storage calls.
	SupabaseAnonKey string
	// JWTSecret is the legacy HS256 JWT secret. Optional: asymmetric keys are read from JWKS.
	JWTSecret string
	// StorageBucket holds every uploaded file.
	StorageBucket string
}

// Load reads the configuration and checks the required values.
func Load() (Config, error) {
	c := Config{
		Port:            env("PORT", "8080"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		SupabaseURL:     strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		SupabaseAnonKey: os.Getenv("SUPABASE_ANON_KEY"),
		JWTSecret:       os.Getenv("SUPABASE_JWT_SECRET"),
		StorageBucket:   env("STORAGE_BUCKET", "documents"),
	}
	var missing []string
	if c.DatabaseURL == "" {
		missing = append(missing, "DATABASE_URL")
	}
	if c.SupabaseURL == "" {
		missing = append(missing, "SUPABASE_URL")
	}
	if c.SupabaseAnonKey == "" {
		missing = append(missing, "SUPABASE_ANON_KEY")
	}
	if len(missing) > 0 {
		return c, errors.New("missing environment variables: " + strings.Join(missing, ", "))
	}
	return c, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
