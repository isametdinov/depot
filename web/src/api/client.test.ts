import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, API_BASE_URL, request } from "./client";

describe("request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hits the configured base URL and endpoint path", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/api/health")).resolves.toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/health`);
  });

  it("parses the backend's error shape into an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "insufficient_stock",
                message: "product 3333… has available 2, requested 5: insufficient stock",
              },
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const err = await request("/reservations", { method: "POST", body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).code).toBe("insufficient_stock");
    expect((err as ApiError).message).toContain("available 2");
  });

  it("turns network failures into an actionable ApiError instead of fake data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const err = await request("/api/health").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("network_error");
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).message).toContain("backend is running");
  });

  it("reports unreadable success responses rather than returning garbage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>oops</html>", { status: 200 })),
    );

    const err = await request("/api/health").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("invalid_response");
  });
});
