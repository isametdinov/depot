package api_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCORS verifies preflight handling and that simple requests pass through
// with CORS headers only for the configured origin.
func TestCORS(t *testing.T) {
	const origin = "http://localhost:5173"
	handler := testHandler

	// Preflight for a POST with Idempotency-Key is answered with 204 and the
	// expected headers, without reaching the router.
	pre := httptest.NewRequest(http.MethodOptions, "/reservations", nil)
	pre.Header.Set("Origin", origin)
	pre.Header.Set("Access-Control-Request-Method", "POST")
	pre.Header.Set("Access-Control-Request-Headers", "Idempotency-Key")
	preRec := httptest.NewRecorder()
	handler.ServeHTTP(preRec, pre)
	if preRec.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", preRec.Code)
	}
	if got := preRec.Header().Get("Access-Control-Allow-Origin"); got != origin {
		t.Fatalf("allow-origin = %q, want %q", got, origin)
	}
	if got := preRec.Header().Get("Access-Control-Allow-Headers"); got != "Content-Type, Idempotency-Key" {
		t.Fatalf("allow-headers = %q", got)
	}

	// A simple request from the allowed origin gets the header and a normal
	// response.
	simple := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	simple.Header.Set("Origin", origin)
	simpleRec := httptest.NewRecorder()
	handler.ServeHTTP(simpleRec, simple)
	if simpleRec.Code != http.StatusOK {
		t.Fatalf("health status = %d", simpleRec.Code)
	}
	if got := simpleRec.Header().Get("Access-Control-Allow-Origin"); got != origin {
		t.Fatalf("allow-origin = %q, want %q", got, origin)
	}

	// A request from another origin gets no CORS header (and the request
	// itself still works server-side).
	other := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	other.Header.Set("Origin", "http://evil.example")
	otherRec := httptest.NewRecorder()
	handler.ServeHTTP(otherRec, other)
	if got := otherRec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unexpected allow-origin for foreign origin: %q", got)
	}
}
