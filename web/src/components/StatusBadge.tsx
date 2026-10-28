import type { ReservationStatus } from "../api/types";
import { useLanguage } from "../language";

/** Semantic, theme-aware badge for the four reservation states. */
export default function StatusBadge({ status }: { status: ReservationStatus }) {
  const { t } = useLanguage();
  return <span className={`badge badge-${status}`}>{t(status)}</span>;
}
