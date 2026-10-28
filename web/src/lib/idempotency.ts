import { randomUUID } from "./uuid";

/**
 * The idempotency key for a reservation attempt plus the exact payload it was
 * created for.
 */
export interface KeyState {
  key: string;
  payload: string;
}

/**
 * Returns the key to send for `payload`:
 *
 * - the same key while the payload is unchanged — so retrying an ambiguous
 *   failed or timed-out request cannot double-book, and the backend replays
 *   the original reservation if it did commit;
 * - a fresh key when the payload changed or this is a new attempt started
 *   from scratch (a new reservation intent).
 */
export function nextKey(state: KeyState | null, payload: string): KeyState {
  if (state && state.payload === payload) return state;
  return { key: randomUUID(), payload };
}
