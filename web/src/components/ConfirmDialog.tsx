import type { ReactNode } from "react";
import Modal from "./Modal";
import { useLanguage } from "../language";

interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks for explicit confirmation before a state-changing request. */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useLanguage();
  return (
    <Modal
      title={title}
      onClose={busy ? () => undefined : onCancel}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {t("Back")}
          </button>
          <button
            type="button"
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? `${t("Working")}…` : confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog-message">{message}</p>
    </Modal>
  );
}
