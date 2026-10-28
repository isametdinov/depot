package api

import (
	"net/http"
	"os"
	"strings"
)

// allowedOrigins lists the browser origins permitted to call the API
// cross-origin, comma-separated. The Vite dev server defaults are included;
// Vite falls back to the next port when 5173 is taken.
func allowedOrigins() []string {
	raw := os.Getenv("CORS_ORIGIN")
	if raw == "" {
		raw = "http://localhost:5173,http://localhost:5174"
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// withCORS lets the configured frontend origins call the API — including the
// Idempotency-Key request header — and answers preflight requests before they
// reach the router. Origins are matched exactly; there is no wildcard.
func withCORS(next http.Handler, origins []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Origin")
		origin := r.Header.Get("Origin")
		if origin != "" {
			for _, allowed := range origins {
				if origin == allowed {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
					w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")
					w.Header().Set("Access-Control-Max-Age", "600")
					break
				}
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
