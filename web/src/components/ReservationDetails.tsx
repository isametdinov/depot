import type { Reservation } from "../api/types";
import StatusBadge from "./StatusBadge";
import { AlertIcon, RefreshIcon } from "../icons";
import { formatDateTime, formatRelative, shortId } from "../lib/format";
import { useLanguage } from "../language";

interface ReservationDetailsProps {
  reservation: Reservation;
  actionPending: boolean;
  actionError: { code: string; message: string } | null;
  onConfirm: () => void;
  onCancel: () => void;
  onRefresh: () => void;
}

/**
 * Renders one reservation from the backend's effective status. Action
 * controls are only offered for `pending` — the backend is authoritative for
 * expiry and re-checks every transition, and errors are shown as returned.
 */
export default function ReservationDetails({
  reservation: r,
  actionPending,
  actionError,
  onConfirm,
  onCancel,
  onRefresh,
}: ReservationDetailsProps) {
  const { language, t } = useLanguage();
  const pending = r.status === "pending";
  const relativeTime = (iso: string) => {
    const value = formatRelative(iso);
    if (!value || language === "en") return value ?? "—";
    if (value === "just now" || value === "in under a minute") return t(value);
    const future = value.match(/^in (\d+)([mhd])$/);
    const unitLabel = (unit: string) => ({ m: "мин", h: "ч", d: "д" })[unit] ?? unit;
    if (future) return t("in {count}{unit}", { count: future[1], unit: unitLabel(future[2]) });
    const past = value.match(/^(\d+)([mhd]) ago$/);
    if (past) return t("{count}{unit} ago", { count: past[1], unit: unitLabel(past[2]) });
    return value;
  };

  return (
    <div className="panel details">
      <div className="details-head">
        <div>
          <span className="details-label">{t("Reservation")}</span>
          <span className="mono wrap details-id">{r.id}</span>
        </div>
        <div className="details-head-actions">
          <StatusBadge status={r.status} />
          <button
            type="button"
            className="icon-btn"
            onClick={onRefresh}
            disabled={actionPending}
            aria-label={t("Refresh reservation")}
          >
            <RefreshIcon size={15} />
          </button>
        </div>
      </div>

      {r.status === "expired" ? (
        <div className="alert alert-warn" role="status">
          <AlertIcon size={15} />
          <span>
            {t("This reservation expired at {time} and no longer holds stock. Expired reservations cannot be confirmed or cancelled.", { time: formatDateTime(r.expires_at, language === "ru" ? "ru-RU" : "en-US") })}
          </span>
        </div>
      ) : null}

      <dl className="detail-grid">
        <div>
          <dt>{t("Warehouse")}</dt>
          <dd className="mono wrap">{r.warehouse_id}</dd>
        </div>
        <div>
          <dt>{t("Created")}</dt>
          <dd>
            <time dateTime={r.created_at}>{formatDateTime(r.created_at, language === "ru" ? "ru-RU" : "en-US")}</time>
            <span className="muted"> ({relativeTime(r.created_at)} )</span>
          </dd>
        </div>
        <div>
          <dt>{t("Expires")}</dt>
          <dd>
            <time dateTime={r.expires_at}>{formatDateTime(r.expires_at, language === "ru" ? "ru-RU" : "en-US")}</time>
            <span className="muted"> ({relativeTime(r.expires_at)} )</span>
          </dd>
        </div>
      </dl>
      <p className="hint">{t("Timestamps are shown in your local timezone.")}</p>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{t("Product")}</th>
              <th scope="col" className="num">{t("Quantity")}</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((item) => (
              <tr key={item.product_id}>
                <td>
                  <span className="mono" title={item.product_id}>
                    {shortId(item.product_id)}
                  </span>
                </td>
                <td className="num strong">{item.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {actionError ? (
        <div className="alert alert-error" role="alert">
          <span className="alert-code">{actionError.code}</span>
          <span>{actionError.message}</span>
          <span className="alert-note">{t("The details above were refreshed from the server.")}</span>
        </div>
      ) : null}

      <div className="details-actions">
        {pending ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onConfirm}
              disabled={actionPending}
            >
              {actionPending ? `${t("Working")}…` : t("Confirm reservation")}
            </button>
            <button
              type="button"
              className="btn btn-danger-ghost"
              onClick={onCancel}
              disabled={actionPending}
            >
              {actionPending ? `${t("Working")}…` : t("Cancel reservation")}
            </button>
          </>
        ) : (
          <p className="muted">
            {r.status === "confirmed"
              ? t("Confirmed — this reservation is finished; no further actions are allowed.")
              : r.status === "cancelled"
                ? t("Cancelled — this reservation is finished; no further actions are allowed.")
                : t("Expired — no further actions are allowed.")}
          </p>
        )}
      </div>
    </div>
  );
}
