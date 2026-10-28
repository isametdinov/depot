/**
 * The API returns RFC 3339 timestamps with a UTC offset. We parse them as
 * instants and display them in the user's local zone, labelled as such.
 */
export function formatDateTime(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** Short relative phrasing like "in 14m" or "2h ago"; null when unparseable. */
export function formatRelative(iso: string, now: Date = new Date()): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return diffSec >= 0 ? "in under a minute" : "just now";
  if (abs < 3600) {
    const m = Math.round(abs / 60);
    return diffSec >= 0 ? `in ${m}m` : `${m}m ago`;
  }
  if (abs < 86400) {
    const h = Math.round(abs / 3600);
    return diffSec >= 0 ? `in ${h}h` : `${h}h ago`;
  }
  const days = Math.round(abs / 86400);
  return diffSec >= 0 ? `in ${days}d` : `${days}d ago`;
}

/** Shortens a UUID for dense table cells while keeping the full value on hover. */
export function shortId(id: string): string {
  return id.length > 15 ? `${id.slice(0, 8)}…` : id;
}
