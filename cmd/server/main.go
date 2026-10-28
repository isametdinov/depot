// Command server is the DEPOT Inventory Reservation Service entry point.
//
// It connects to PostgreSQL, applies the embedded idempotent migrations and
// serves the HTTP API, shutting down gracefully on SIGINT/SIGTERM.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"depot/internal/api"
	"depot/internal/store"
	"depot/migrations"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is not set (copy .env.example to .env and adjust it)")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.New(ctx, dsn)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer st.Close()

	if err := st.ApplyMigrations(ctx, migrations.FS); err != nil {
		log.Fatalf("migrations: %v", err)
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           api.NewServer(st).Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("DEPOT server listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
	log.Println("server stopped")
}
