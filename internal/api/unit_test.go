package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"depot/internal/store"
)

// --- request validation (no database involved) -----------------------------

func TestValidateCreateRequest(t *testing.T) {
	validWH := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	validP1 := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	validP2 := "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

	item := func(pid string, qty int64) store.ReservationItem {
		return store.ReservationItem{ProductID: pid, Quantity: qty}
	}

	cases := []struct {
		name    string
		req     createReservationRequest
		wantErr string // empty = valid
	}{
		{"valid multi-item", createReservationRequest{
			WarehouseID: validWH,
			Items:       []store.ReservationItem{item(validP1, 1), item(validP2, 999_999)},
		}, ""},
		{"missing warehouse", createReservationRequest{
			WarehouseID: "", Items: []store.ReservationItem{item(validP1, 1)},
		}, "warehouse_id must be a UUID"},
		{"warehouse not a uuid", createReservationRequest{
			WarehouseID: "42", Items: []store.ReservationItem{item(validP1, 1)},
		}, "warehouse_id must be a UUID"},
		{"empty items", createReservationRequest{
			WarehouseID: validWH, Items: nil,
		}, "at least one item"},
		{"zero quantity", createReservationRequest{
			WarehouseID: validWH, Items: []store.ReservationItem{item(validP1, 0)},
		}, "positive integer"},
		{"negative quantity", createReservationRequest{
			WarehouseID: validWH, Items: []store.ReservationItem{item(validP1, -7)},
		}, "positive integer"},
		{"unreasonable quantity", createReservationRequest{
			WarehouseID: validWH, Items: []store.ReservationItem{item(validP1, store.MaxQuantity + 1)},
		}, "must not exceed"},
		{"product not a uuid", createReservationRequest{
			WarehouseID: validWH, Items: []store.ReservationItem{item("999", 1)},
		}, "product_id must be a UUID"},
		{"duplicate product", createReservationRequest{
			WarehouseID: validWH,
			Items:       []store.ReservationItem{item(validP1, 1), item(validP1, 2)},
		}, "duplicate product_id"},
		{"too many items", createReservationRequest{
			WarehouseID: validWH,
			Items:       manyItems(validP1, store.MaxItemsPerReservation+1),
		}, "at most"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateCreateRequest(&tc.req)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantErr)
			}
		})
	}
}

// manyItems builds n items; product uuids only need to be unique and valid.
func manyItems(first string, n int) []store.ReservationItem {
	out := make([]store.ReservationItem, 0, n)
	for i := 0; i < n; i++ {
		// Distinct valid UUIDs derived from the first (same version/variant).
		pid := fmt.Sprintf("%08x-1111-4111-8111-111111111111", i)
		out = append(out, store.ReservationItem{ProductID: pid, Quantity: 1})
	}
	_ = first
	return out
}

// --- path parameter parsing ------------------------------------------------

func TestPathUUID(t *testing.T) {
	const valid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	cases := []struct {
		value   string
		wantErr bool
	}{
		{valid, false},
		{"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", false},
		{"abc", true},
		{"0", true},
		{"", true},
		{"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa", true},   // too short
		{"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaazzzz", true}, // non-hex
	}
	for _, tc := range cases {
		t.Run("value="+tc.value, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/reservations/x", nil)
			req.SetPathValue("reservation_id", tc.value)
			got, err := pathUUID(req, "reservation_id")
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q", tc.value)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.value {
				t.Fatalf("got %q, want %q", got, tc.value)
			}
		})
	}
}

// --- JSON decoding ---------------------------------------------------------

func TestDecodeJSON(t *testing.T) {
	type payload struct {
		Name string `json:"name"`
	}

	t.Run("valid object", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"depot"}`))
		var p payload
		if err := decodeJSON(httptest.NewRecorder(), req, &p); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.Name != "depot" {
			t.Fatalf("name = %q", p.Name)
		}
	})

	t.Run("malformed json", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":`))
		var p payload
		if err := decodeJSON(httptest.NewRecorder(), req, &p); err == nil {
			t.Fatal("expected an error for malformed JSON")
		}
	})

	t.Run("unknown field rejected", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"x","nope":1}`))
		var p payload
		if err := decodeJSON(httptest.NewRecorder(), req, &p); err == nil {
			t.Fatal("expected an error for an unknown field")
		}
	})

	t.Run("trailing content rejected", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"x"}{"name":"y"}`))
		var p payload
		if err := decodeJSON(httptest.NewRecorder(), req, &p); err == nil {
			t.Fatal("expected an error for trailing content")
		}
	})
}

// --- idempotency key header ------------------------------------------------

func TestIdempotencyKey(t *testing.T) {
	t.Run("missing", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/reservations", nil)
		if _, msg := idempotencyKey(req); msg == "" {
			t.Fatal("expected a validation message for a missing key")
		}
	})

	t.Run("blank", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/reservations", nil)
		req.Header.Set("Idempotency-Key", "   ")
		if _, msg := idempotencyKey(req); msg == "" {
			t.Fatal("expected a validation message for a blank key")
		}
	})

	t.Run("too long", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/reservations", nil)
		req.Header.Set("Idempotency-Key", strings.Repeat("k", 201))
		if _, msg := idempotencyKey(req); msg == "" {
			t.Fatal("expected a validation message for an oversized key")
		}
	})

	t.Run("valid", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/reservations", nil)
		req.Header.Set("Idempotency-Key", "  abc-123  ")
		key, msg := idempotencyKey(req)
		if msg != "" {
			t.Fatalf("unexpected message: %s", msg)
		}
		if key != "abc-123" {
			t.Fatalf("key = %q, want trimmed %q", key, "abc-123")
		}
	})
}

// --- error-to-HTTP-status mapping -----------------------------------------

func TestWriteStoreErrorMapping(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"not found", fmt.Errorf("reservation abc: %w", store.ErrNotFound), http.StatusNotFound, "not_found"},
		{"insufficient stock", fmt.Errorf("product x has available 1: %w", store.ErrInsufficientStock), http.StatusConflict, "insufficient_stock"},
		{"idempotency conflict", fmt.Errorf("key k: %w", store.ErrIdempotencyConflict), http.StatusConflict, "idempotency_conflict"},
		{"invalid transition", fmt.Errorf("r is confirmed: %w", store.ErrInvalidTransition), http.StatusConflict, "invalid_transition"},
		{"expired", fmt.Errorf("reservation x: %w", store.ErrReservationExpired), http.StatusConflict, "reservation_expired"},
		{"stock below reserved", fmt.Errorf("physical 1: %w", store.ErrStockBelowReserved), http.StatusConflict, "stock_below_reserved"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeStoreError(rec, tc.err)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			body := decodeErrorBody(t, rec)
			if body["code"] != tc.wantCode {
				t.Fatalf("code = %q, want %q", body["code"], tc.wantCode)
			}
			if body["message"] == "" {
				t.Fatal("message must not be empty")
			}
		})
	}

	t.Run("unknown errors are generic 500s", func(t *testing.T) {
		rec := httptest.NewRecorder()
		writeStoreError(rec, errors.New("pq: password authentication failed for user postgres"))
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		if strings.Contains(rec.Body.String(), "password") || strings.Contains(rec.Body.String(), "pq:") {
			t.Fatalf("internal error leaked database details: %s", rec.Body.String())
		}
		body := decodeErrorBody(t, rec)
		if body["code"] != "internal_error" {
			t.Fatalf("code = %q", body["code"])
		}
	})
}

// decodeErrorBody parses the API's single error shape and fails the test when
// the shape is broken.
func decodeErrorBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var envelope struct {
		Error map[string]string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("error response is not valid JSON: %v (%s)", err, rec.Body.String())
	}
	if envelope.Error == nil {
		t.Fatalf("error response missing the error object: %s", rec.Body.String())
	}
	return envelope.Error
}
