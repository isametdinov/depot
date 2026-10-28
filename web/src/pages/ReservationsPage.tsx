import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, isAbort } from "../api/client";
import { cancelReservation, confirmReservation, getReservation } from "../api/endpoints";
import type { Reservation } from "../api/types";
import ConfirmDialog from "../components/ConfirmDialog";
import ReservationDetails from "../components/ReservationDetails";
import { useToasts } from "../components/Toasts";
import { SearchIcon } from "../icons";
import { isUuid } from "../lib/validate";
import { useLanguage } from "../language";

interface ReservationsPageProps {
  /** Pre-filled lookup id passed in when opening a created reservation. */
  initialLookupId: string;
}

/**
 * The backend has no reservation listing endpoint, so this page is a lookup
 * form backed by GET /reservations/{id} — no listing API is invented.
 */
export default function ReservationsPage({ initialLookupId }: ReservationsPageProps) {
  const { t } = useLanguage();
  const [input, setInput] = useState(initialLookupId);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<{ code: string; message: string } | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);
  const [dialogTarget, setDialogTarget] = useState<"confirm" | "cancel" | null>(null);
  const toasts = useToasts();
  const abortRef = useRef<AbortController | null>(null);

  const load = async (id: string, opts: { silent?: boolean } = {}) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!opts.silent) {
      setLoading(true);
      setLookupError(null);
    }
    try {
      const res = await getReservation(id, controller.signal);
      setReservation(res);
      setLookupError(null);
      return res;
    } catch (e) {
      if (isAbort(e)) return null;
      if (e instanceof ApiError) {
        const message =
          e.code === "not_found"
            ? t("No reservation with id {id}.", { id })
            : e.message;
        if (opts.silent) {
          setActionError({ code: e.code, message });
        } else {
          setReservation(null);
          setLookupError({ code: e.code, message });
        }
      } else if (!opts.silent) {
        setReservation(null);
        setLookupError({ code: "unknown_error", message: t("Lookup failed. Please try again.") });
      }
      return null;
    } finally {
      if (!opts.silent) setLoading(false);
    }
  };

  // Open a reservation passed in from the Inventory page.
  useEffect(() => {
    if (initialLookupId) {
      setInput(initialLookupId);
      void load(initialLookupId);
    }
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLookupId]);

  const submitLookup = (e: FormEvent) => {
    e.preventDefault();
    const id = input.trim();
    if (!isUuid(id)) {
      setReservation(null);
      setLookupError({
        code: "invalid_id",
        message: t("Enter a valid reservation UUID (8-4-4-4-12 hexadecimal)."),
      });
      return;
    }
    setActionError(null);
    void load(id);
  };

  const runAction = async () => {
    if (!reservation || !dialogTarget) return;
    const action = dialogTarget;
    setActionPending(true);
    setActionError(null);
    try {
      const updated =
        action === "confirm"
          ? await confirmReservation(reservation.id)
          : await cancelReservation(reservation.id);
      setDialogTarget(null);
      setReservation(updated);
      toasts.push(
        "success",
        t("Reservation {id} is now {status}.", { id: reservation.id.slice(0, 8), status: t(updated.status) }),
      );
    } catch (e) {
      setDialogTarget(null);
      if (isAbort(e)) return;
      if (e instanceof ApiError) {
        setActionError({ code: e.code, message: e.message });
        // The backend is authoritative — refresh so the UI shows real state.
        await load(reservation.id, { silent: true });
      } else {
        setActionError({ code: "unknown_error", message: t("The request failed. Please try again.") });
      }
    } finally {
      setActionPending(false);
    }
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t("Reservations")}</h1>
          <p className="page-desc">
            {t("Look up a reservation by its ID, inspect its status and confirm or cancel it.")}
          </p>
        </div>
      </header>

      <div className="panel">
        <form className="lookup-form" onSubmit={submitLookup} noValidate>
          <div className="control-group grow">
            <label htmlFor="reservation-id">{t("Reservation ID")}</label>
            <div className="inline-form">
              <input
                id="reservation-id"
                className={lookupError ? "input input-invalid" : "input"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("Reservation UUID")}
                aria-invalid={lookupError ? true : undefined}
              />
              <button type="submit" className="btn btn-primary" disabled={loading}>
                <SearchIcon size={15} /> {loading ? t("Looking up…") : t("Look up")}
              </button>
            </div>
          </div>
        </form>

        {lookupError ? (
          <div className="alert alert-error" role="alert">
            <span className="alert-code">{lookupError.code}</span>
            <span>{lookupError.message}</span>
          </div>
        ) : null}

        {!reservation && !lookupError && !loading ? (
          <div className="empty-state">
            <h2>{t("No reservation loaded")}</h2>
            <p>
              {t("The API has no listing endpoint — paste a reservation ID to fetch it. IDs are shown after creating a reservation on the Inventory page.")}
            </p>
          </div>
        ) : null}
      </div>

      {reservation ? (
        <ReservationDetails
          reservation={reservation}
          actionPending={actionPending}
          actionError={actionError}
          onConfirm={() => setDialogTarget("confirm")}
          onCancel={() => setDialogTarget("cancel")}
          onRefresh={() => {
            setActionError(null);
            void load(reservation.id);
          }}
        />
      ) : null}

      {dialogTarget && reservation ? (
        <ConfirmDialog
          title={dialogTarget === "confirm" ? t("Confirm reservation?") : t("Cancel reservation?")}
          message={
            dialogTarget === "confirm"
              ? t("Confirming finalizes this reservation and releases its stock hold. This cannot be undone.")
              : t("Cancelling releases the held stock back to the warehouse. This cannot be undone.")
          }
          confirmLabel={dialogTarget === "confirm" ? t("Confirm") : t("Cancel reservation")}
          danger={dialogTarget === "cancel"}
          busy={actionPending}
          onConfirm={() => void runAction()}
          onCancel={() => setDialogTarget(null)}
        />
      ) : null}
    </section>
  );
}
