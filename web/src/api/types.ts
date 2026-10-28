/** Reservation states as returned by the backend (effective status). */
export type ReservationStatus = "pending" | "confirmed" | "cancelled" | "expired";

/** GET /warehouses/{w}/products/{p}/stock */
export interface Stock {
  warehouse_id: string;
  product_id: string;
  physical_stock: number;
  reserved_stock: number;
  available_stock: number;
}

/** GET /warehouses */
export interface Warehouse {
  id: string;
  name: string;
}

/** GET /products */
export interface Product {
  id: string;
  sku: string;
  name: string;
}

/** One line of a reservation. */
export interface ReservationItem {
  product_id: string;
  quantity: number;
}

/** Reservation as returned by create/get/confirm/cancel. */
export interface Reservation {
  id: string;
  warehouse_id: string;
  status: ReservationStatus;
  expires_at: string;
  created_at: string;
  items: ReservationItem[];
}

/** Body of POST /reservations. */
export interface CreateReservationRequest {
  warehouse_id: string;
  items: ReservationItem[];
}

/** Body of POST /warehouses/{w}/stock. */
export interface SetStockRequest {
  product_id: string;
  quantity: number;
}

/** The backend's single error shape: {"error": {"code", "message"}}. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}
