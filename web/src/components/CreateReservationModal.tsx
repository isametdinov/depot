import { useMemo, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { createReservation, getStock } from "../api/endpoints";
import type { Reservation, Stock } from "../api/types";
import Modal from "./Modal";
import StatusBadge from "./StatusBadge";
import { useToasts } from "./Toasts";
import { PlusIcon, TrashIcon } from "../icons";
import { nextKey, type KeyState } from "../lib/idempotency";
import { isUuid, parseQuantity } from "../lib/validate";
import { shortId } from "../lib/format";
import { useLanguage } from "../language";

interface CreateReservationModalProps {
  warehouseId: string;
  /** Available product ids from the catalog and any local watchlist. */
  products: string[];
  productLabels?: Record<string, string>;
  /** Latest stock rows from the API, keyed by product id. */
  stockByProduct: Record<string, Stock>;
  onClose: () => void;
  /** Called after a successful create so the page can refresh stock. */
  onCreated: (reservation: Reservation) => void;
  /** Opens the reservation details page (used from the success view). */
  onOpenDetails: (id: string) => void;
}

interface Line {
  id: number;
  productId: string;
  quantity: string;
}

/**
 * Multi-item reservation form. Business rules stay on the server: this form
 * only mirrors the documented request contract (one warehouse, unique
 * products, positive quantities) and displays the backend's real responses.
 *
 * One Idempotency-Key is generated per reservation attempt and kept while the
 * payload is unchanged, so retrying an ambiguous failure cannot double-book.
 */
export default function CreateReservationModal({
  warehouseId,
  products,
  productLabels = {},
  stockByProduct,
  onClose,
  onCreated,
  onOpenDetails,
}: CreateReservationModalProps) {
  const [lines, setLines] = useState<Line[]>([{ id: 1, productId: "", quantity: "" }]);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<{ code: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Reservation | null>(null);
  const [resultStock, setResultStock] = useState<Record<string, Stock>>({});
  const [stockRefreshPending, setStockRefreshPending] = useState(false);
  const [stockRefreshError, setStockRefreshError] = useState<string | null>(null);
  const [keyState, setKeyState] = useState<KeyState | null>(null);
  const toasts = useToasts();
  const { t } = useLanguage();

  const addLine = () => {
    setLines((current) => [
      ...current,
      { id: Math.max(0, ...current.map((l) => l.id)) + 1, productId: "", quantity: "" },
    ]);
  };

  const removeLine = (id: number) => {
    setLines((current) => (current.length > 1 ? current.filter((l) => l.id !== id) : current));
    setLineErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const updateLine = (id: number, patch: Partial<Line>) => {
    setLines((current) => current.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setLineErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  // Validate and build the exact request body; null when invalid.
  const buildBody = (): { warehouse_id: string; items: { product_id: string; quantity: number }[] } | null => {
    const errors: Record<number, string> = {};
    const seen = new Set<string>();
    const items: { product_id: string; quantity: number }[] = [];

    for (const line of lines) {
      const pid = line.productId.trim();
      if (!pid) {
        errors[line.id] = "Select a product.";
        continue;
      }
      if (!isUuid(pid)) {
        errors[line.id] = "Not a valid product UUID.";
        continue;
      }
      if (seen.has(pid)) {
        errors[line.id] = "Duplicate product — each product may appear once (backend contract).";
        continue;
      }
      const qty = parseQuantity(line.quantity);
      if (qty === null) {
        errors[line.id] = "Quantity must be a whole number from 1 to 1,000,000.";
        continue;
      }
      seen.add(pid);
      items.push({ product_id: pid, quantity: qty });
    }

    if (items.length === 0 && Object.keys(errors).length === 0) {
      setFormError("A reservation needs at least one item.");
      return null;
    }
    setLineErrors(errors);
    if (Object.keys(errors).length > 0) return null;
    setFormError(null);
    return { warehouse_id: warehouseId, items };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setRequestError(null);

    const body = buildBody();
    if (!body) return;

    // Same unchanged payload → reuse the key (safe retry after an ambiguous
    // failure); a changed payload or fresh start → new key.
    const payload = JSON.stringify(body);
    const next = nextKey(keyState, payload);
    if (next !== keyState) setKeyState(next);

    setPending(true);
    try {
      const reservation = await createReservation(body, next.key);
      setResult(reservation);
      setResultStock({});
      setStockRefreshError(null);
      setStockRefreshPending(true);
      toasts.push("success", t("Reservation {id} created ({status})", { id: reservation.id.slice(0, 8), status: t(reservation.status) }));
      onCreated(reservation);
      void Promise.all(
        reservation.items.map((item) => getStock(warehouseId, item.product_id)),
      )
        .then((stocks) => {
          setResultStock(Object.fromEntries(stocks.map((stock) => [stock.product_id, stock])));
        })
        .catch((error: unknown) => {
          setStockRefreshError(
            error instanceof ApiError
              ? t("Reservation succeeded, but updated stock could not be loaded: {message}", { message: error.message })
              : t("Reservation succeeded, but updated stock could not be loaded. Refresh inventory to check it."),
          );
        })
        .finally(() => setStockRefreshPending(false));
    } catch (err) {
      if (err instanceof ApiError) {
        setRequestError({ code: err.code, message: err.message });
        if (err.code === "timeout" || err.code === "network_error") {
          // The key is intentionally kept: a retry reuses the same key.
        }
      } else {
        setRequestError({ code: "unknown_error", message: t("Something went wrong. Please try again.") });
      }
    } finally {
      setPending(false);
    }
  };

  const totalUnits = useMemo(
    () => lines.reduce((sum, l) => sum + (parseQuantity(l.quantity) ?? 0), 0),
    [lines],
  );

  // ---- Success view -------------------------------------------------------
  if (result) {
    return (
      <Modal
        title={t("Reservation created")}
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setResult(null);
                setResultStock({});
                setStockRefreshError(null);
                setKeyState(null);
                setLines([{ id: 1, productId: "", quantity: "" }]);
              }}
            >
              {t("Create another")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {t("Back to inventory")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onOpenDetails(result.id);
                onClose();
              }}
            >
              {t("Open details")}
            </button>
          </>
        }
      >
        <dl className="result-list">
          <div>
            <dt>{t("Reservation ID")}</dt>
            <dd className="mono wrap">{result.id}</dd>
          </div>
          <div>
            <dt>{t("Status")}</dt>
            <dd>
              <StatusBadge status={result.status} />
            </dd>
          </div>
          <div>
            <dt>{t("Items")}</dt>
            <dd>{t("{lines} line(s), {units} unit(s)", { lines: result.items.length, units: result.items.reduce((s, i) => s + i.quantity, 0) })}</dd>
          </div>
        </dl>
        <div className="reservation-stock-impact" aria-live="polite">
          <strong>{t("Inventory updated")}</strong>
          <p>{t("Physical stock stays the same while this reservation is active. Reserved stock increases and available stock decreases.")}</p>
          {result.items.map((item) => {
            const stock = resultStock[item.product_id];
            return (
              <div className="reservation-impact-row" key={item.product_id}>
                <span>{productLabels[item.product_id] ?? shortId(item.product_id)}</span>
                <strong>
                  {stock
                    ? t("{reserved} reserved · {available} available", { reserved: stock.reserved_stock, available: stock.available_stock })
                    : t("{quantity} unit(s) reserved", { quantity: item.quantity })}
                </strong>
              </div>
            );
          })}
          {stockRefreshPending ? <p className="hint">{t("Refreshing stock from the API…")}</p> : null}
          {stockRefreshError ? (
            <div className="alert alert-error" role="alert">
              <span>{stockRefreshError}</span>
            </div>
          ) : null}
        </div>
        <p className="hint">{t("Confirm or cancel this reservation from the Reservations page.")}</p>
      </Modal>
    );
  }

  // ---- Form ---------------------------------------------------------------
  return (
    <Modal
      title={t("Create reservation")}
      onClose={pending ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            {t("Cancel")}
          </button>
          <button type="submit" form="create-reservation-form" className="btn btn-primary" disabled={pending}>
            {pending ? t("Submitting…") : t("Create reservation")}
          </button>
        </>
      }
    >
      <form id="create-reservation-form" onSubmit={submit} noValidate>
        <div className="field">
          <span className="label-like" id="cr-warehouse-label">
            {t("Warehouse")}
          </span>
          <p className="mono value-like" aria-labelledby="cr-warehouse-label">{warehouseId}</p>
        </div>

        <div className="field">
          <span className="label-like">{t("Items")}</span>
          <ul className="line-list">
            {lines.map((line) => {
              const stock = line.productId ? stockByProduct[line.productId] : undefined;
              return (
                <li key={line.id} className="line-row">
                  <label className="sr-only" htmlFor={`line-product-${line.id}`}>
                    {t("Product for line")}
                  </label>
                  <select
                    id={`line-product-${line.id}`}
                    className="input line-product"
                    value={line.productId}
                    onChange={(e) => updateLine(line.id, { productId: e.target.value })}
                    disabled={pending}
                  >
                    <option value="">{t("Select product…")}</option>
                    {products.map((p) => (
                      <option key={p} value={p}>
                        {productLabels[p] ?? shortId(p)}
                      </option>
                    ))}
                    {line.productId && !products.includes(line.productId) ? (
                      <option value={line.productId}>
                        {productLabels[line.productId] ?? shortId(line.productId)}
                      </option>
                    ) : null}
                  </select>

                  <label className="sr-only" htmlFor={`line-qty-${line.id}`}>
                    {t("Quantity for line")}
                  </label>
                  <input
                    id={`line-qty-${line.id}`}
                    className="input line-qty"
                    type="text"
                    inputMode="numeric"
                    placeholder={t("Qty")}
                    value={line.quantity}
                    onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                    disabled={pending}
                  />

                  <span className="line-available" title={t("Available stock from the last API refresh")}>
                    {stock ? `${stock.available_stock} ${t("avail.")}` : `— ${t("avail.")}`}
                  </span>

                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => removeLine(line.id)}
                    disabled={pending || lines.length === 1}
                    aria-label={t("Remove line")}
                  >
                    <TrashIcon size={15} />
                  </button>

                  {lineErrors[line.id] ? (
                    <p className="field-error line-error">{t(lineErrors[line.id])}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addLine} disabled={pending}>
            <PlusIcon size={14} /> {t("Add line")}
          </button>
        </div>

        <div className="summary" aria-label={t("Order summary")}>
          <strong>{t("Order summary:")}</strong> {t("{lines} line(s), {units} unit(s)", { lines: lines.length, units: totalUnits })} — {t("warehouse")}{" "}
          <span className="mono">{shortId(warehouseId)}</span>. {t("Stock is validated by the server.")}
        </div>

        {formError ? (
          <div className="alert alert-error" role="alert">
            <span>{t(formError)}</span>
          </div>
        ) : null}

        {requestError ? (
          <div className="alert alert-error" role="alert">
            <span className="alert-code">{requestError.code}</span>
            <span>{requestError.message}</span>
            {requestError.code === "timeout" || requestError.code === "network_error" ? (
              <span className="alert-note">
                Retrying with the same payload reuses the same idempotency key, so it cannot
                double-book.
              </span>
            ) : null}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
