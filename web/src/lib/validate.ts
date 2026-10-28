/** UUID shape accepted by the Go API (case-insensitive). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** The backend's per-line maximum (store.MaxQuantity). */
export const MAX_QUANTITY = 1_000_000;

/**
 * Parses a reservation line quantity: a positive integer within the backend
 * limit, or null when invalid.
 */
export function parseQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_QUANTITY) return null;
  return n;
}

/**
 * Parses a stock quantity: a non-negative integer within the backend limit
 * (the stock endpoint allows setting stock to zero), or null when invalid.
 */
export function parseStockQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_QUANTITY) return null;
  return n;
}
