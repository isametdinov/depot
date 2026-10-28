package api

import (
	"errors"
	"fmt"
	"net/http"

	"depot/internal/store"
)

type createReservationRequest struct {
	WarehouseID string                   `json:"warehouse_id"`
	Items       []store.ReservationItem `json:"items"`
}

// handleCreateReservation implements POST /reservations.
//
// 201 + the reservation on first use of an Idempotency-Key, 201 + the original
// reservation (with X-Idempotent-Replay: true) on a retry with the same key and
// body, 409 when the key is reused with a different body.
func (s *Server) handleCreateReservation(w http.ResponseWriter, r *http.Request) {
	var req createReservationRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if err := validateCreateRequest(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	key, errMsg := idempotencyKey(r)
	if errMsg != "" {
		writeError(w, http.StatusBadRequest, "missing_idempotency_key", errMsg)
		return
	}

	res, replayed, err := s.store.CreateReservation(r.Context(), store.CreateReservationInput{
		WarehouseID:    req.WarehouseID,
		Items:          req.Items,
		IdempotencyKey: key,
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if replayed {
		w.Header().Set("X-Idempotent-Replay", "true")
	}
	writeJSON(w, http.StatusCreated, res)
}

// handleGetReservation implements GET /reservations/{reservation_id}.
func (s *Server) handleGetReservation(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "reservation_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", err.Error())
		return
	}
	res, err := s.store.GetReservation(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// handleConfirmReservation implements POST /reservations/{reservation_id}/confirm.
func (s *Server) handleConfirmReservation(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "reservation_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", err.Error())
		return
	}
	res, err := s.store.ConfirmReservation(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// handleCancelReservation implements POST /reservations/{reservation_id}/cancel.
func (s *Server) handleCancelReservation(w http.ResponseWriter, r *http.Request) {
	id, err := pathUUID(r, "reservation_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", err.Error())
		return
	}
	res, err := s.store.CancelReservation(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// validateCreateRequest enforces the creation contract: one warehouse (UUID),
// 1..100 items, valid UUID product ids, quantities within 1..MaxQuantity.
func validateCreateRequest(req *createReservationRequest) error {
	if !uuidPattern.MatchString(req.WarehouseID) {
		return fmt.Errorf("warehouse_id must be a UUID, got %q", req.WarehouseID)
	}
	if len(req.Items) == 0 {
		return errors.New("items must contain at least one item")
	}
	if len(req.Items) > store.MaxItemsPerReservation {
		return fmt.Errorf("items must contain at most %d entries", store.MaxItemsPerReservation)
	}
	seen := make(map[string]bool, len(req.Items))
	for i, it := range req.Items {
		if !uuidPattern.MatchString(it.ProductID) {
			return fmt.Errorf("items[%d].product_id must be a UUID, got %q", i, it.ProductID)
		}
		if it.Quantity <= 0 {
			return fmt.Errorf("items[%d].quantity must be a positive integer", i)
		}
		if it.Quantity > store.MaxQuantity {
			return fmt.Errorf("items[%d].quantity must not exceed %d", i, store.MaxQuantity)
		}
		if seen[it.ProductID] {
			return fmt.Errorf("duplicate product_id %s in items", it.ProductID)
		}
		seen[it.ProductID] = true
	}
	return nil
}
