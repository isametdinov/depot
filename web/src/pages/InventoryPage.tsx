import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, isAbort } from "../api/client";
import { getStock, listProducts, listWarehouses } from "../api/endpoints";
import type { Product, Reservation, Stock, Warehouse } from "../api/types";
import AddStockModal from "../components/AddStockModal";
import CreateReservationModal from "../components/CreateReservationModal";
import { AlertIcon, PlusIcon, RefreshIcon, SearchIcon, TrashIcon } from "../icons";

import { shortId } from "../lib/format";
import {
  loadProducts,
  loadHiddenProducts,
  loadSelectedWarehouse,
  loadWarehouses,
  saveProducts,
  saveHiddenProducts,
  saveSelectedWarehouse,
  saveWarehouses,
} from "../lib/storage";
import { isUuid } from "../lib/validate";
import { useLanguage } from "../language";

interface InventoryPageProps {
  onOpenReservation: (id: string) => void;
}

interface RowResult {
  stock?: Stock;
  error?: string;
}

/**
 * Inventory page. Catalog data and stock quantities are loaded from the API;
 * local UUID watchlists only preserve manually added entries between visits.
 */
export default function InventoryPage({ onOpenReservation }: InventoryPageProps) {
  const { t } = useLanguage();
  const initialWarehouses = useMemo(() => loadWarehouses(), []);
  const [warehouses, setWarehouses] = useState<string[]>(initialWarehouses);
  const [warehouseId, setWarehouseId] = useState<string>(() => {
    const selected = loadSelectedWarehouse();
    return initialWarehouses.includes(selected) ? selected : (initialWarehouses[0] ?? "");
  });
  const [products, setProducts] = useState<string[]>(() =>
    loadProducts(initialWarehouses.includes(loadSelectedWarehouse())
      ? loadSelectedWarehouse()
      : (initialWarehouses[0] ?? "")),
  );
  const [warehouseCatalog, setWarehouseCatalog] = useState<Record<string, Warehouse>>({});
  const [productCatalog, setProductCatalog] = useState<Record<string, Product>>({});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [warehouseInput, setWarehouseInput] = useState("");
  const [warehouseError, setWarehouseError] = useState<string | null>(null);
  const [productInput, setProductInput] = useState("");
  const [productError, setProductError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const [rows, setRows] = useState<Record<string, RowResult>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [addStockOpen, setAddStockOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);

    void Promise.all([
      listWarehouses(controller.signal),
      listProducts(controller.signal),
    ])
      .then(([warehouseList, productList]) => {
        if (cancelled) return;

        const warehouseIds = warehouseList.map((warehouse) => warehouse.id);
        const hidden = new Set(warehouseId ? loadHiddenProducts(warehouseId) : []);
        const productIds = productList.map((product) => product.id).filter((id) => !hidden.has(id));
        setWarehouseCatalog(Object.fromEntries(warehouseList.map((w) => [w.id, w])));
        setProductCatalog(Object.fromEntries(productList.map((p) => [p.id, p])));
        setWarehouses((current) => {
          const next = [...new Set([...warehouseIds, ...current])];
          saveWarehouses(next);
          return next;
        });
        setWarehouseId((current) => {
          const known = new Set([...warehouseIds, ...loadWarehouses()]);
          if (current && known.has(current)) return current;
          const preferred = loadSelectedWarehouse();
          const next = known.has(preferred) ? preferred : [...known][0] ?? "";
          if (next) saveSelectedWarehouse(next);
          return next;
        });
        setProducts((current) => {
          const saved = warehouseId ? loadProducts(warehouseId) : [];
          const next = [...new Set([...productIds, ...saved, ...current])].filter((id) => !hidden.has(id));
          if (warehouseId) saveProducts(warehouseId, next);
          return next;
        });
      })
      .catch((error: unknown) => {
        if (cancelled || isAbort(error)) return;
        setCatalogError(
          error instanceof ApiError
            ? t("Could not load products and warehouses: {message}", { message: error.message })
            : t("Could not load products and warehouses. Check that the API is reachable."),
        );
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [warehouseId, reloadKey]);

  // Load stock for every catalog product and locally tracked product in the
  // selected warehouse. Stale requests are aborted when either list changes.
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    if (!warehouseId) {
      setRows({});
      setLoading(false);
      setLoadError(null);
      return () => controller.abort();
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void (async () => {
      const results = await Promise.all(
        products.map(async (p): Promise<RowResult & { p: string }> => {
          try {
            const stock = await getStock(warehouseId, p, controller.signal);
            return { p, stock };
          } catch (e) {
            if (isAbort(e)) return { p };
            if (e instanceof ApiError) {
              if (e.code === "not_found") return { p, error: "Not stocked in this warehouse" };
              if (e.status === 0) return { p, error: "" }; // transport error → surfaced globally
              return { p, error: e.message };
            }
            return { p, error: "Failed to load this row." };
          }
        }),
      );
      if (cancelled) return;

      const next: Record<string, RowResult> = {};
      let transportMessage: string | null = null;
      for (const r of results) {
        if (r.stock) {
          next[r.p] = { stock: r.stock };
        } else if (r.error === "") {
          transportMessage = t("Some stock could not be loaded. Check that the API is reachable.");
        } else {
          next[r.p] = { error: r.error };
        }
      }
      setRows(next);
      setLoadError(transportMessage);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [warehouseId, products, reloadKey]);

  const selectWarehouse = (id: string) => {
    setWarehouseId(id);
    saveSelectedWarehouse(id);
    const hidden = new Set(loadHiddenProducts(id));
    setProducts(loadProducts(id).filter((productId) => !hidden.has(productId)));
    setFilter("");
    setProductInput("");
  };

  const addWarehouse = () => {
    const id = warehouseInput.trim().toLowerCase();
    if (!isUuid(id)) {
      setWarehouseError("Enter a valid warehouse UUID.");
      return;
    }
    if (!warehouses.includes(id)) {
      const next = [...warehouses, id];
      setWarehouses(next);
      saveWarehouses(next);
    }
    setWarehouseInput("");
    setWarehouseError(null);
    selectWarehouse(id);
  };

  const addProduct = () => {
    const id = productInput.trim().toLowerCase();
    if (!isUuid(id)) {
      setProductError("Enter a valid product UUID.");
      return;
    }
    if (!warehouseId) {
      setProductError("Select or add a warehouse first.");
      return;
    }
    if (!products.includes(id)) {
      saveHiddenProducts(warehouseId, loadHiddenProducts(warehouseId).filter((productId) => productId !== id));
      const next = [...products, id];
      setProducts(next);
      saveProducts(warehouseId, next);
    }
    setProductInput("");
    setProductError(null);
  };

  const removeProduct = (id: string) => {
    if (!warehouseId) return;
    const next = products.filter((p) => p !== id);
    saveHiddenProducts(warehouseId, [...new Set([...loadHiddenProducts(warehouseId), id])]);
    setProducts(next);
    saveProducts(warehouseId, next);
  };

  const refresh = () => setReloadKey((k) => k + 1);

  const normalizedFilter = filter.trim().toLowerCase();
  const filteredProducts = products.filter((id) => {
    const product = productCatalog[id];
    return `${id} ${product?.name ?? ""} ${product?.sku ?? ""}`
      .toLowerCase()
      .includes(normalizedFilter);
  });

  const summary = (() => {
    let physical = 0;
    let reserved = 0;
    let available = 0;
    let loaded = 0;
    for (const p of products) {
      const s = rows[p]?.stock;
      if (s) {
        loaded++;
        physical += s.physical_stock;
        reserved += s.reserved_stock;
        available += s.available_stock;
      }
    }
    return { physical, reserved, available, loaded };
  })();

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t("Inventory")}</h1>
          <p className="page-desc">
            {t("Live stock for the selected warehouse, read from the API on every refresh.")}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={refresh} disabled={loading || !warehouseId}>
            <RefreshIcon size={15} /> {loading ? `${t("Refreshing")}…` : t("Refresh")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setAddStockOpen(true)}
            disabled={!warehouseId}
          >
            <PlusIcon size={15} /> {t("Add stock")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreateOpen(true)}
            disabled={!warehouseId}
          >
            {t("Create reservation")}
          </button>
        </div>
      </header>

      <div className="panel toolbar">
        <div className="control-group">
          <label htmlFor="warehouse-select">{t("Warehouse")}</label>
          <select
            id="warehouse-select"
            className="input"
            value={warehouseId}
            onChange={(e) => selectWarehouse(e.target.value)}
            disabled={warehouses.length === 0}
          >
            {warehouses.length === 0 ? <option value="">{t("No warehouse yet")}</option> : null}
            {warehouses.map((w) => (
              <option key={w} value={w}>
                {warehouseCatalog[w] ? `${warehouseCatalog[w].name} (${shortId(w)})` : shortId(w)}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group grow">
          <label htmlFor="warehouse-input">{t("Add warehouse ID")}</label>
          <div className="inline-form">
            <input
              id="warehouse-input"
              className={warehouseError ? "input input-invalid" : "input"}
              value={warehouseInput}
              onChange={(e) => setWarehouseInput(e.target.value)}
              placeholder={t("Warehouse UUID")}
              aria-invalid={warehouseError ? true : undefined}
            />
            <button type="button" className="btn btn-ghost" onClick={addWarehouse}>
              {t("Add")}
            </button>
          </div>
          {warehouseError ? <p className="field-error">{t(warehouseError)}</p> : null}
        </div>

        <div className="control-group grow">
          <label htmlFor="product-input">{t("Track product")}</label>
          <div className="inline-form">
            <input
              id="product-input"
              className={productError ? "input input-invalid" : "input"}
              value={productInput}
              onChange={(e) => setProductInput(e.target.value)}
              placeholder={t("Product UUID")}
              disabled={!warehouseId}
              aria-invalid={productError ? true : undefined}
            />
            <button type="button" className="btn btn-ghost" onClick={addProduct} disabled={!warehouseId}>
              {t("Add")}
            </button>
          </div>
          {productError ? <p className="field-error">{t(productError)}</p> : null}
        </div>
      </div>

      <div className="panel stats" aria-label={t("Stock summary")}>
        <div className="stat">
          <span className="stat-label">{t("Products")}</span>
          <span className="stat-value">
            {summary.loaded}
            <span className="stat-sub">{t(" / {count} loaded", { count: products.length })}</span>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("Physical")}</span>
          <span className="stat-value">{summary.physical}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("Reserved")}</span>
          <span className="stat-value">{summary.reserved}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("Available")}</span>
          <span className="stat-value">{summary.available}</span>
        </div>
      </div>

      {!warehouseId ? (
        <div className="panel empty-state">
          <h2>{t("No warehouse selected")}</h2>
          {catalogError ? (
            <div className="alert alert-error" role="alert">
              <AlertIcon size={15} />
              <span>{t(catalogError)}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>
                {t("Retry")}
              </button>
            </div>
          ) : null}
          <p>
            {catalogLoading
              ? t("Loading warehouses from the API…")
              : t("No warehouse is available yet. Add a warehouse ID, then set stock to create it.")}
          </p>
        </div>
      ) : (
        <>
          {catalogError ? (
            <div className="alert alert-error" role="alert">
              <AlertIcon size={15} />
              <span>{t(catalogError)}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>
                {t("Retry")}
              </button>
            </div>
          ) : null}

          {loadError ? (
            <div className="alert alert-error" role="alert">
              <AlertIcon size={15} />
              <span>{t(loadError)}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>
                {t("Retry")}
              </button>
            </div>
          ) : null}

          <div className="panel table-panel">
            <div className="table-toolbar">
              <div className="search-box">
                <SearchIcon size={15} />
                <input
                  className="input search-input"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("Filter products…")}
                  aria-label={t("Filter products")}
                />
              </div>
              <span className="muted">
                {catalogLoading || loading ? t("Loading inventory…") : `${filteredProducts.length} ${t("product(s)")}`}
              </span>
            </div>

            {products.length === 0 ? (
              <div className="empty-state">
                <h2>{t("No products tracked")}</h2>
                <p>{t("Products appear here when available from the API. Add stock to create a product.")}</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t("Product")}</th>
                      <th scope="col" className="num">{t("Physical")}</th>
                      <th scope="col" className="num">{t("Reserved")}</th>
                      <th scope="col" className="num">{t("Available")}</th>
                      <th scope="col">{t("Status")}</th>
                      <th scope="col"><span className="sr-only">{t("Remove")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((p) => {
                      const row = rows[p];
                      const stock = row?.stock;
                      return (
                        <tr key={p}>
                          <td>
                            <span title={p}>{productCatalog[p]?.name ?? shortId(p)}</span>
                            <br />
                            <span className="mono muted" title={p}>
                              {productCatalog[p]?.sku ?? p}
                            </span>
                          </td>
                          {stock ? (
                            <>
                              <td className="num">{stock.physical_stock}</td>
                              <td className="num">{stock.reserved_stock}</td>
                              <td className="num strong">{stock.available_stock}</td>
                              <td>
                                <span
                                  className={`stock-chip ${
                                    stock.available_stock <= 0
                                      ? "stock-out"
                                      : stock.available_stock < 10
                                        ? "stock-low"
                                        : "stock-ok"
                                  }`}
                                >
                                  {stock.available_stock <= 0
                                    ? t("Out of stock")
                                    : stock.available_stock < 10
                                      ? t("Low")
                                      : t("In stock")}
                                </span>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="num muted">—</td>
                              <td className="num muted">—</td>
                              <td className="num muted">—</td>
                              <td>
                                <span className="stock-chip stock-unknown">
                                  {loading ? t("Loading…") : (row?.error ? t(row.error) : t("Unavailable"))}
                                </span>
                              </td>
                            </>
                          )}
                          <td className="row-actions">
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={t("Stop tracking {id}", { id: p })}
                              title={t("Remove from this view")}
                              onClick={() => removeProduct(p)}
                            >
                              <TrashIcon size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {addStockOpen && warehouseId ? (
        <AddStockModal
          warehouseId={warehouseId}
          products={[...new Set([...Object.keys(productCatalog), ...products])]}
          productLabels={Object.fromEntries(
            Object.entries(productCatalog).map(([id, product]) => [id, `${product.name} · ${product.sku}`]),
          )}
          onClose={() => setAddStockOpen(false)}
          onSaved={(productId) => {
            if (warehouseId) {
              saveHiddenProducts(
                warehouseId,
                loadHiddenProducts(warehouseId).filter(
                  (hiddenId) => hiddenId !== productId.trim().toLowerCase(),
                ),
              );
            }
            refresh();
          }}
        />
      ) : null}

      {createOpen && warehouseId ? (
        <CreateReservationModal
          warehouseId={warehouseId}
          products={products}
          productLabels={Object.fromEntries(
            Object.entries(productCatalog).map(([id, product]) => [id, `${product.name} · ${product.sku}`]),
          )}
          stockByProduct={Object.fromEntries(
            Object.entries(rows)
              .map(([p, r]) => [p, r.stock] as const)
              .filter(([, s]) => s !== undefined),
          ) as Record<string, Stock>}
          onClose={() => setCreateOpen(false)}
          onCreated={(_res: Reservation) => refresh()}
          onOpenDetails={onOpenReservation}
        />
      ) : null}
    </section>
  );
}
