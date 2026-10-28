package api

import (
	"net/http"
)

func (s *Server) handleListWarehouses(w http.ResponseWriter, r *http.Request) {
	warehouses, err := s.store.ListWarehouses(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, warehouses)
}

func (s *Server) handleListProducts(w http.ResponseWriter, r *http.Request) {
	products, err := s.store.ListProducts(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, products)
}
