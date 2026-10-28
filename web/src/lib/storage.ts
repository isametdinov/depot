import { isUuid } from "./validate";

/** Local UI preferences and manually added UUIDs; inventory remains API data. */
const WAREHOUSES_KEY = "depot-warehouses";
const PRODUCTS_KEY = "depot-products";
const HIDDEN_PRODUCTS_KEY = "depot-hidden-products";
const SELECTED_KEY = "depot-selected-warehouse";

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

function readString(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function loadWarehouses(): string[] {
  const v = readJSON<string[]>(WAREHOUSES_KEY, []);
  return Array.isArray(v) ? v.filter(isUuid) : [];
}

export function saveWarehouses(ids: string[]): void {
  writeJSON(WAREHOUSES_KEY, ids);
}

export function loadProducts(warehouseId: string): string[] {
  const all = readJSON<Record<string, string[]>>(PRODUCTS_KEY, {});
  const list = all[warehouseId];
  return Array.isArray(list) ? list.filter(isUuid) : [];
}

export function saveProducts(warehouseId: string, ids: string[]): void {
  const all = readJSON<Record<string, string[]>>(PRODUCTS_KEY, {});
  all[warehouseId] = ids;
  writeJSON(PRODUCTS_KEY, all);
}

export function loadHiddenProducts(warehouseId: string): string[] {
  const all = readJSON<Record<string, string[]>>(HIDDEN_PRODUCTS_KEY, {});
  const list = all[warehouseId];
  return Array.isArray(list) ? list.filter(isUuid) : [];
}

export function saveHiddenProducts(warehouseId: string, ids: string[]): void {
  const all = readJSON<Record<string, string[]>>(HIDDEN_PRODUCTS_KEY, {});
  all[warehouseId] = ids;
  writeJSON(HIDDEN_PRODUCTS_KEY, all);
}

export function loadSelectedWarehouse(): string {
  return readString(SELECTED_KEY);
}

export function saveSelectedWarehouse(id: string): void {
  writeString(SELECTED_KEY, id);
}
