import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { setStock } from "../api/endpoints";
import Modal from "./Modal";
import { useToasts } from "./Toasts";
import { isUuid, parseStockQuantity } from "../lib/validate";
import { useLanguage } from "../language";

interface AddStockModalProps {
  warehouseId: string;
  /** Known product UUIDs offered as catalog options. */
  products: string[];
  productLabels?: Record<string, string>;
  /** Pre-filled product when opened from a table row. */
  initialProductId?: string;
  onClose: () => void;
  /** Called after a successful write so the page can refresh from the API. */
  onSaved: (productId: string) => void;
}

/**
 * Sets the absolute physical stock for one product via
 * POST /warehouses/{id}/stock. Submits are disabled while a request is in
 * flight, so duplicate submissions are impossible.
 */
export default function AddStockModal({
  warehouseId,
  products,
  productLabels = {},
  initialProductId = "",
  onClose,
  onSaved,
}: AddStockModalProps) {
  const [productId, setProductId] = useState(initialProductId);
  const [quantity, setQuantity] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ product?: string; quantity?: string }>({});
  const [requestError, setRequestError] = useState<{ code: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const toasts = useToasts();
  const { t } = useLanguage();

  const validate = () => {
    const errors: { product?: string; quantity?: string } = {};
    if (!isUuid(productId)) errors.product = "Select a product.";
    const qty = parseStockQuantity(quantity);
    if (qty === null) errors.quantity = "Quantity must be a whole number between 0 and 1,000,000.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0 ? qty : null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setRequestError(null);
    const qty = validate();
    if (qty === null) return;

    setPending(true);
    try {
      const stock = await setStock(warehouseId, { product_id: productId.trim(), quantity: qty });
      toasts.push("success", t("Stock set to {qty} for {id}", { qty: stock.physical_stock, id: productId.slice(0, 8) }));
      onSaved(productId.trim());
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setRequestError({ code: err.code, message: err.message });
      } else {
        setRequestError({ code: "unknown_error", message: t("Something went wrong. Please try again.") });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={t("Add stock")}
      onClose={pending ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            {t("Cancel")}
          </button>
          <button type="submit" form="add-stock-form" className="btn btn-primary" disabled={pending}>
            {pending ? t("Saving…") : t("Set stock")}
          </button>
        </>
      }
    >
      <form id="add-stock-form" onSubmit={submit} noValidate>
        <p className="hint">
          {t("Warehouse")} <code className="mono">{warehouseId}</code> — {t("stock is set to an absolute quantity by the API.")}
        </p>

        <div className="field">
          <label htmlFor="stock-product">{t("Product")}</label>
          <select
            id="stock-product"
            className={fieldErrors.product ? "input input-invalid" : "input"}
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            disabled={pending}
            aria-invalid={fieldErrors.product ? true : undefined}
            aria-describedby={fieldErrors.product ? "stock-product-error" : undefined}
          >
            <option value="">{t("Select a product…")}</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {productLabels[p] ?? p}
              </option>
            ))}
          </select>
          {fieldErrors.product ? (
            <p id="stock-product-error" className="field-error">
              {t(fieldErrors.product)}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="stock-quantity">{t("Set physical quantity")}</label>
          <input
            id="stock-quantity"
            type="text"
            inputMode="numeric"
            className={fieldErrors.quantity ? "input input-invalid" : "input"}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="100"
            disabled={pending}
            aria-invalid={fieldErrors.quantity ? true : undefined}
            aria-describedby={fieldErrors.quantity ? "stock-quantity-error" : undefined}
          />
          {fieldErrors.quantity ? (
            <p id="stock-quantity-error" className="field-error">
              {t(fieldErrors.quantity)}
            </p>
          ) : null}
        </div>

        {requestError ? (
          <div className="alert alert-error" role="alert">
            <span className="alert-code">{requestError.code}</span>
            <span>{requestError.message}</span>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
