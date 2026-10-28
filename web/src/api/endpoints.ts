import { request } from "./client";
import type {
  CreateReservationRequest,
  Product,
  Reservation,
  SetStockRequest,
  Stock,
  Warehouse,
} from "./types";

/** GET /warehouses */
export function listWarehouses(signal?: AbortSignal): Promise<Warehouse[]> {
  return request<Warehouse[]>("/warehouses", { signal });
}

/** GET /products */
export function listProducts(signal?: AbortSignal): Promise<Product[]> {
  return request<Product[]>("/products", { signal });
}

/** GET /warehouses/{w}/products/{p}/stock */
export function getStock(warehouseId: string, productId: string, signal?: AbortSignal): Promise<Stock> {
  return request<Stock>(`/warehouses/${warehouseId}/products/${productId}/stock`, { signal });
}

/** POST /warehouses/{w}/stock — sets the absolute physical quantity. */
export function setStock(
  warehouseId: string,
  body: SetStockRequest,
  signal?: AbortSignal,
): Promise<Stock> {
  return request<Stock>(`/warehouses/${warehouseId}/stock`, { method: "POST", body, signal });
}

/** POST /reservations — requires the Idempotency-Key header. */
export function createReservation(
  body: CreateReservationRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Reservation> {
  return request<Reservation>("/reservations", {
    method: "POST",
    body,
    headers: { "Idempotency-Key": idempotencyKey },
    signal,
  });
}

/** GET /reservations/{id} */
export function getReservation(id: string, signal?: AbortSignal): Promise<Reservation> {
  return request<Reservation>(`/reservations/${id}`, { signal });
}

/** POST /reservations/{id}/confirm */
export function confirmReservation(id: string, signal?: AbortSignal): Promise<Reservation> {
  return request<Reservation>(`/reservations/${id}/confirm`, { method: "POST", signal });
}

/** POST /reservations/{id}/cancel */
export function cancelReservation(id: string, signal?: AbortSignal): Promise<Reservation> {
  return request<Reservation>(`/reservations/${id}/cancel`, { method: "POST", signal });
}
