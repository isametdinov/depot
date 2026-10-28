package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"depot/internal/store"
)

// writeJSON writes a JSON response body.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("write response: %v", err)
	}
}

// writeError writes the single error shape used by the whole API:
//
//	{"error": {"code": "...", "message": "..."}}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}

// writeStoreError maps store sentinel errors onto the API contract:
// 404 for unknown resources, 409 for insufficient stock, idempotency-key
// conflicts and invalid state transitions, 500 for anything unexpected.
// Only messages built by our own code are ever sent to the client — raw
// database errors are logged, never leaked.
func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", err.Error())
	case errors.Is(err, store.ErrInsufficientStock):
		writeError(w, http.StatusConflict, "insufficient_stock", err.Error())
	case errors.Is(err, store.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "idempotency_conflict", err.Error())
	case errors.Is(err, store.ErrInvalidTransition):
		writeError(w, http.StatusConflict, "invalid_transition", err.Error())
	case errors.Is(err, store.ErrReservationExpired):
		writeError(w, http.StatusConflict, "reservation_expired", err.Error())
	case errors.Is(err, store.ErrStockBelowReserved):
		writeError(w, http.StatusConflict, "stock_below_reserved", err.Error())
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		// The client went away; there is nobody left to answer.
		log.Printf("request canceled: %v", err)
	default:
		log.Printf("internal error: %v", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}
