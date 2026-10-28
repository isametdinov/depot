import { describe, expect, it } from "vitest";
import { nextKey } from "./idempotency";

describe("nextKey", () => {
  const payload = JSON.stringify({ warehouse_id: "w", items: [{ product_id: "a", quantity: 1 }] });
  const otherPayload = JSON.stringify({ warehouse_id: "w", items: [{ product_id: "a", quantity: 2 }] });

  it("creates a key for a fresh attempt", () => {
    const state = nextKey(null, payload);
    expect(state.payload).toBe(payload);
    expect(state.key).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("reuses the key while the payload is unchanged (safe retry)", () => {
    const first = nextKey(null, payload);
    const retry = nextKey(first, payload);
    expect(retry.key).toBe(first.key);
  });

  it("issues a new key when the payload changes (new intent)", () => {
    const first = nextKey(null, payload);
    const changed = nextKey(first, otherPayload);
    expect(changed.key).not.toBe(first.key);
    expect(changed.payload).toBe(otherPayload);
  });
});
