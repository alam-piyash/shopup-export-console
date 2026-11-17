// Command api serves the ShopUp Export Console REST API.
//
// It runs as a normal HTTP server: on Vercel (Go framework preset, behind Vercel Services)
// or in any container. Configuration comes from environment variables (see internal/config).
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/alam-piyash/shopup-export-console/api/internal/auth"
	"github.com/alam-piyash/shopup-export-console/api/internal/config"
	"github.com/alam-piyash/shopup-export-console/api/internal/db"
	"github.com/alam-piyash/shopup-export-console/api/internal/httpapi"
	"github.com/alam-piyash/shopup-export-console/api/internal/storage"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	database, err := db.Open(ctx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		log.Error("database", "err", err)
		os.Exit(1)
	}
	defer database.Close()

	srv := &httpapi.Server{
		DB:      database,
		Auth:    auth.NewVerifier(cfg.SupabaseURL, cfg.SupabaseAnonKey, cfg.JWTSecret),
		Storage: storage.New(cfg.SupabaseURL, cfg.SupabaseAnonKey, cfg.StorageBucket),
		Log:     log,
	}
	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      70 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Info("listening", "port", cfg.Port)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdown)
}
