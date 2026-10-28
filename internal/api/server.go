// Package api exposes the DEPOT inventory reservation API as a net/http
// handler. Handlers validate input, call the store and translate store errors
// into the JSON error contract — no business logic lives here.
package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"depot/internal/store"
)

// uuidPattern matches the canonical 8-4-4-4-12 hexadecimal form used by the
// existing schema (all ids in the DEPOT database are UUIDs).
var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Server holds the dependencies of the HTTP layer.
type Server struct {
	store *store.Store
}

// NewServer builds the API around a store.
func NewServer(st *store.Store) *Server {
	return &Server{store: st}
}

// Routes returns the full route table.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /warehouses", s.handleListWarehouses)
	mux.HandleFunc("GET /products", s.handleListProducts)
	mux.HandleFunc("POST /warehouses/{warehouse_id}/stock", s.handleSetStock)
	mux.HandleFunc("GET /warehouses/{warehouse_id}/products/{product_id}/stock", s.handleGetStock)
	mux.HandleFunc("POST /reservations", s.handleCreateReservation)
	mux.HandleFunc("GET /reservations/{reservation_id}", s.handleGetReservation)
	mux.HandleFunc("POST /reservations/{reservation_id}/confirm", s.handleConfirmReservation)
	mux.HandleFunc("POST /reservations/{reservation_id}/cancel", s.handleCancelReservation)
	return withCORS(mux, allowedOrigins())
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// --- stock -----------------------------------------------------------------

type setStockRequest struct {
	ProductID string `json:"product_id"`
	Quantity  int64  `json:"quantity"`
}

// handleSetStock sets physical stock for one product in one warehouse
// (creating the rows if missing — this is how stock is seeded).
func (s *Server) handleSetStock(w http.ResponseWriter, r *http.Request) {
	warehouseID, err := pathUUID(r, "warehouse_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", err.Error())
		return
	}
	var req setStockRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if !uuidPattern.MatchString(req.ProductID) {
		writeError(w, http.StatusBadRequest, "invalid_request", fmt.Sprintf("product_id must be a UUID, got %q", req.ProductID))
		return
	}
	if req.Quantity < 0 || req.Quantity > store.MaxQuantity {
		writeError(w, http.StatusBadRequest, "invalid_request",
			fmt.Sprintf("quantity must be between 0 and %d", store.MaxQuantity))
		return
	}

	stock, err := s.store.SetStock(r.Context(), warehouseID, req.ProductID, req.Quantity)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stock)
}

// handleGetStock returns physical, reserved and available stock for one
// product in one warehouse.
func (s *Server) handleGetStock(w http.ResponseWriter, r *http.Request) {
	warehouseID, err := pathUUID(r, "warehouse_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", err.Error())
		return
	}
	productID, err := pathUUID(r, "product_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", err.Error())
		return
	}

	stock, err := s.store.GetStock(r.Context(), warehouseID, productID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stock)
}

// --- helpers ---------------------------------------------------------------

// pathUUID parses and validates a UUID path parameter.
func pathUUID(r *http.Request, name string) (string, error) {
	raw := r.PathValue(name)
	if !uuidPattern.MatchString(raw) {
		return "", fmt.Errorf("%s must be a UUID, got %q", name, raw)
	}
	return raw, nil
}

// decodeJSON decodes exactly one JSON object with unknown fields rejected.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB is plenty
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("body must contain exactly one JSON object")
	}
	return nil
}

// idempotencyKey reads and validates the Idempotency-Key header.
func idempotencyKey(r *http.Request) (string, string) {
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		return "", "Idempotency-Key header is required"
	}
	if len(key) > 200 {
		return "", "Idempotency-Key must be at most 200 characters"
	}
	return key, ""
}
