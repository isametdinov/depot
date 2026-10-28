import { useEffect, useMemo, useState } from "react";
import { ApiError, isAbort } from "../api/client";
import { getStock, listProducts, listWarehouses } from "../api/endpoints";
import type { Product, Stock, Warehouse } from "../api/types";
import { loadSelectedWarehouse, saveSelectedWarehouse } from "../lib/storage";
import { shortId } from "../lib/format";
import { AlertIcon, BoxIcon, PlusIcon, RefreshIcon } from "../icons";
import { useLanguage } from "../language";

interface DashboardPageProps {
  onOpenInventory: () => void;
  onOpenReservations: () => void;
}

function DashboardIcon({ kind }: { kind: "warehouse" | "reserve" | "stock" }) {
  if (kind === "warehouse") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 10.5 12 4l9 6.5V21H3z" />
        <path d="M8 21v-7h8v7M7 10h.01M12 10h.01M17 10h.01" />
      </svg>
    );
  }
  if (kind === "reserve") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16v16H4zM8 3v4M16 3v4M4 10h16" />
        <path d="m9 15 2 2 4-4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </svg>
  );
}

export default function DashboardPage({
  onOpenInventory,
  onOpenReservations,
}: DashboardPageProps) {
  const { t } = useLanguage();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [stockByProduct, setStockByProduct] = useState<Record<string, Stock>>({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [stockLoading, setStockLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
        setWarehouses(warehouseList);
        setProducts(productList);
        const preferred = loadSelectedWarehouse();
        const selected = warehouseList.some((warehouse) => warehouse.id === preferred)
          ? preferred
          : (warehouseList[0]?.id ?? "");
        setWarehouseId(selected);
        if (selected) saveSelectedWarehouse(selected);
      })
      .catch((error: unknown) => {
        if (cancelled || isAbort(error)) return;
        setCatalogError(
          error instanceof ApiError
            ? t("Could not load your Depot catalog: {message}", { message: error.message })
            : t("Could not load your Depot catalog. Check that the API is reachable."),
        );
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setStockByProduct({});
    setStockError(null);

    if (!warehouseId || products.length === 0) {
      setStockLoading(false);
      return () => controller.abort();
    }

    setStockLoading(true);
    void Promise.all(
      products.map(async (product) => {
        try {
          return await getStock(warehouseId, product.id, controller.signal);
        } catch (error) {
          if (isAbort(error)) return null;
          if (error instanceof ApiError && error.code === "not_found") return null;
          throw error;
        }
      }),
    )
      .then((stocks) => {
        if (cancelled) return;
        const stockRows = stocks.filter((stock): stock is Stock => stock !== null);
        setStockByProduct(Object.fromEntries(stockRows.map((stock) => [stock.product_id, stock])));
      })
      .catch((error: unknown) => {
        if (cancelled || isAbort(error)) return;
        setStockError(
          error instanceof ApiError
            ? t("Could not load live stock: {message}", { message: error.message })
            : t("Could not load live stock. Check that the API is reachable."),
        );
      })
      .finally(() => {
        if (!cancelled) setStockLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [warehouseId, products]);

  const totals = useMemo(
    () =>
      Object.values(stockByProduct).reduce(
        (sum, stock) => ({
          physical: sum.physical + stock.physical_stock,
          reserved: sum.reserved + stock.reserved_stock,
          available: sum.available + stock.available_stock,
        }),
        { physical: 0, reserved: 0, available: 0 },
      ),
    [stockByProduct],
  );

  const currentWarehouse = warehouses.find((warehouse) => warehouse.id === warehouseId);
  const stockedProducts = products.filter((product) => stockByProduct[product.id]);
  const chartCircumference = 2 * Math.PI * 37;
  const availableArc = totals.physical
    ? (totals.available / totals.physical) * chartCircumference
    : 0;
  const reservedArc = totals.physical
    ? (totals.reserved / totals.physical) * chartCircumference
    : 0;

  return (
    <section className="dashboard">
      <div className="dashboard-topline">
        <div className="dashboard-eyebrow">
          <span className="eyebrow-dot" />
          {t("YOUR OPERATIONS, AT A GLANCE")}
        </div>
        <button
          type="button"
          className="dashboard-refresh"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={catalogLoading || stockLoading}
        >
          <RefreshIcon size={15} />
          {catalogLoading || stockLoading ? t("Syncing") : t("Refresh")}
        </button>
      </div>

      {catalogError ? (
        <div className="alert alert-error" role="alert">
          <AlertIcon size={15} />
          <span>{catalogError}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReloadKey((key) => key + 1)}>
            {t("Try again")}
          </button>
        </div>
      ) : null}

      <section className="dashboard-hero" aria-labelledby="dashboard-title">
        <div className="hero-copy">
          <p className="hero-kicker">{t("WELCOME TO DEPOT")}</p>
          <h1 id="dashboard-title">
            {t("Stock that moves")}
            <br />
            <span>{t("with your business.")}</span>
          </h1>
          <p className="hero-description">
            {t("A quieter, clearer way to keep inventory in view. Know what is on hand, what is reserved, and what is ready to go — all in one place.")}
          </p>
          <div className="hero-actions">
            <button type="button" className="btn hero-primary" onClick={onOpenInventory}>
              <BoxIcon size={17} />
              {t("Open inventory")}
            </button>
            <button type="button" className="btn hero-secondary" onClick={onOpenReservations}>
              {t("View reservations")}
            </button>
          </div>
          <div className="hero-note">
            <span className="live-indicator" />
            <span>{t("Connected to your live inventory")}</span>
          </div>
        </div>

        <div className="hero-visual" aria-label={t("Live stock overview")}>
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="visual-card">
            <div className="visual-card-top">
              <div>
                <span className="visual-label">{t("INVENTORY SNAPSHOT")}</span>
                <strong className="visual-warehouse">
                  {currentWarehouse?.name ?? (catalogLoading ? t("Finding your warehouse…") : t("No warehouse yet"))}
                </strong>
              </div>
              <span className={`sync-badge ${stockLoading ? "is-syncing" : ""}`}>
                <span /> {stockLoading ? t("Syncing") : t("Live")}
              </span>
            </div>

            <div className="stock-ring-wrap">
              <svg className="stock-ring" viewBox="0 0 100 100" role="img" aria-label={t("{count} units available", { count: totals.available })}>
                <circle className="ring-track" cx="50" cy="50" r="37" />
                <circle
                  className="ring-available"
                  cx="50"
                  cy="50"
                  r="37"
                  strokeDasharray={`${availableArc} ${chartCircumference}`}
                />
                <circle
                  className="ring-reserved"
                  cx="50"
                  cy="50"
                  r="37"
                  strokeDasharray={`${reservedArc} ${chartCircumference}`}
                  strokeDashoffset={-availableArc}
                />
              </svg>
              <div className="ring-center">
                <strong>{stockLoading ? "—" : totals.available.toLocaleString()}</strong>
                <span>{t("available")}</span>
              </div>
            </div>

            <div className="visual-legend">
              <div><span className="legend-dot available-dot" />{t("Available")} <strong>{totals.available.toLocaleString()}</strong></div>
              <div><span className="legend-dot reserved-dot" />{t("Reserved")} <strong>{totals.reserved.toLocaleString()}</strong></div>
              <div><span className="legend-dot physical-dot" />{t("Physical")} <strong>{totals.physical.toLocaleString()}</strong></div>
            </div>

            <div className="visual-card-foot">
              <span>{stockedProducts.length} {t("products stocked")}</span>
              <span className="visual-foot-mark">DEPOT <span>·</span> {t("STOCK, IN SYNC")}</span>
            </div>
          </div>
          <span className="visual-spark spark-one" />
          <span className="visual-spark spark-two" />
        </div>
      </section>

      <section className="dashboard-metrics" aria-label={t("Inventory summary")}>
        <article className="metric-card">
          <span className="metric-icon metric-icon-teal"><BoxIcon size={18} /></span>
          <div><span className="metric-label">{t("Available to move")}</span><strong>{stockLoading ? "—" : totals.available.toLocaleString()}</strong><small>{t("units ready for orders")}</small></div>
          <span className="metric-corner">01</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon metric-icon-amber"><DashboardIcon kind="reserve" /></span>
          <div><span className="metric-label">{t("Held for customers")}</span><strong>{stockLoading ? "—" : totals.reserved.toLocaleString()}</strong><small>{t("units in active reservations")}</small></div>
          <span className="metric-corner">02</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon metric-icon-blue"><DashboardIcon kind="warehouse" /></span>
          <div><span className="metric-label">{t("Product catalog")}</span><strong>{catalogLoading ? "—" : products.length.toLocaleString()}</strong><small>{t("products across {count} locations", { count: warehouses.length })}</small></div>
          <span className="metric-corner">03</span>
        </article>
      </section>

      {stockError ? (
        <div className="alert alert-error" role="alert">
          <AlertIcon size={15} />
          <span>{stockError}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReloadKey((key) => key + 1)}>
            {t("Try again")}
          </button>
        </div>
      ) : null}

      <section className="dashboard-lower">
        <div className="dashboard-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t("A SIMPLE WORKFLOW")}</span>
              <h2>{t("From shelf to shipped.")}</h2>
            </div>
            <span className="section-aside">{t("Built to keep the everyday moving.")}</span>
          </div>
          <div className="workflow-grid">
            <article className="workflow-card">
              <span className="workflow-number">01</span>
              <span className="workflow-icon"><DashboardIcon kind="warehouse" /></span>
              <h3>{t("Keep stock visible")}</h3>
              <p>{t("See physical, reserved, and available quantities for every product at a glance.")}</p>
              <button type="button" className="text-action" onClick={onOpenInventory}>{t("Explore inventory")} <span>↗</span></button>
            </article>
            <article className="workflow-card">
              <span className="workflow-number">02</span>
              <span className="workflow-icon workflow-icon-warm"><PlusIcon size={20} /></span>
              <h3>{t("Set what you have")}</h3>
              <p>{t("Update warehouse quantities in seconds and keep your live picture accurate.")}</p>
              <button type="button" className="text-action" onClick={onOpenInventory}>{t("Update stock")} <span>↗</span></button>
            </article>
            <article className="workflow-card">
              <span className="workflow-number">03</span>
              <span className="workflow-icon workflow-icon-blue"><DashboardIcon kind="reserve" /></span>
              <h3>{t("Reserve with confidence")}</h3>
              <p>{t("Hold items for a customer with all-or-nothing reservations and safe retries.")}</p>
              <button type="button" className="text-action" onClick={onOpenReservations}>{t("See reservations")} <span>↗</span></button>
            </article>
          </div>
        </div>

        <aside className="dashboard-aside">
          <div className="warehouse-card">
            <div className="warehouse-card-top">
              <span className="section-kicker">{t("YOUR WORKSPACE")}</span>
              <span className="warehouse-card-icon"><DashboardIcon kind="warehouse" /></span>
            </div>
            <h2>{currentWarehouse?.name ?? (catalogLoading ? t("Loading locations…") : t("Ready when you are"))}</h2>
            <p>
              {currentWarehouse
                ? t("{stocked} of {total} catalog products have stock at this location.", { stocked: stockedProducts.length, total: products.length })
                : t("Add a warehouse and start building your inventory.")}
            </p>
            {warehouses.length > 1 ? (
              <label className="dashboard-location">
                <span>{t("Active location")}</span>
                <select
                  value={warehouseId}
                  onChange={(event) => {
                    setWarehouseId(event.target.value);
                    saveSelectedWarehouse(event.target.value);
                  }}
                  aria-label={t("Select dashboard warehouse")}
                >
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </select>
              </label>
            ) : currentWarehouse ? (
              <span className="warehouse-id">{shortId(currentWarehouse.id)}</span>
            ) : null}
          </div>

          <div className="product-preview">
            <div className="preview-heading">
              <div><span className="section-kicker">{t("ON YOUR SHELVES")}</span><h2>{t("Stock highlights")}</h2></div>
              <button type="button" className="preview-link" onClick={onOpenInventory}>{t("All stock")} <span>↗</span></button>
            </div>
            {catalogLoading || stockLoading ? (
              <p className="preview-empty">{t("Checking your live stock…")}</p>
            ) : stockedProducts.length > 0 ? (
              <ul className="preview-list">
                {stockedProducts.slice(0, 4).map((product) => {
                  const stock = stockByProduct[product.id];
                  return (
                    <li key={product.id}>
                      <span className="product-initial">{product.name.slice(0, 1).toUpperCase()}</span>
                      <span className="preview-product-name"><strong>{product.name}</strong><small>{product.sku}</small></span>
                      <span className="preview-quantity"><strong>{stock.available_stock}</strong><small>{t("available")}</small></span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="preview-empty">{catalogError || stockError || t("No stocked products here yet. Add stock to see it appear.")}</p>
            )}
          </div>
        </aside>
      </section>

      <footer className="dashboard-footer-note">
        <span className="footer-note-mark">D</span>
        <p><strong>{t("Less guesswork. More good work.")}</strong><span>{t("Depot keeps the details in order, so you can keep everything else moving.")}</span></p>
        <button type="button" className="text-action" onClick={onOpenInventory}>{t("Go to inventory")} <span>↗</span></button>
      </footer>
    </section>
  );
}
