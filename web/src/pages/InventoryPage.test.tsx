import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import InventoryPage from "./InventoryPage";
import { ToastsProvider } from "../components/Toasts";

const WH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stockJSON = {
  warehouse_id: WH,
  product_id: P1,
  physical_stock: 120,
  reserved_stock: 5,
  available_stock: 115,
};

function seedWatchlist() {
  localStorage.setItem("depot-warehouses", JSON.stringify([WH]));
  localStorage.setItem("depot-products", JSON.stringify({ [WH]: [P1] }));
  localStorage.setItem("depot-selected-warehouse", WH);
}

function renderPage() {
  return render(
    <ToastsProvider>
      <InventoryPage onOpenReservation={() => undefined} />
    </ToastsProvider>,
  );
}

describe("InventoryPage", () => {
  beforeEach(() => {
    localStorage.clear();
    seedWatchlist();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads and displays live stock from the API", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/warehouses")) {
          return new Response(JSON.stringify([{ id: WH, name: "Main warehouse" }]), { status: 200 });
        }
        if (url.endsWith("/products")) {
          return new Response(
            JSON.stringify([{ id: P1, sku: "SKU-01", name: "Widget" }]),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(stockJSON), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    // Real API values, not hardcoded: stock chip and table numbers appear.
    expect(await screen.findByText("In stock")).toBeTruthy();
    expect(screen.getAllByText("115").length).toBeGreaterThan(0); // available (row + summary)
    expect(screen.getAllByText("120").length).toBeGreaterThan(0); // physical
    expect(screen.getAllByText("5").length).toBeGreaterThan(0); // reserved
    expect(await screen.findByText("Widget")).toBeTruthy();
    expect(screen.getByText(/loaded/)).toBeTruthy(); // summary line
    const requestedUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(requestedUrls.some((url) => url.endsWith("/warehouses"))).toBe(true);
    expect(requestedUrls.some((url) => url.endsWith("/products"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes(`/warehouses/${WH}/products/${P1}/stock`))).toBe(true);
  });

  it("refreshes inventory and shows the hold after creating a reservation", async () => {
    let reservedStock = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/warehouses")) {
        return new Response(JSON.stringify([{ id: WH, name: "Main warehouse" }]), { status: 200 });
      }
      if (url.endsWith("/products")) {
        return new Response(
          JSON.stringify([{ id: P1, sku: "SKU-01", name: "Widget" }]),
          { status: 200 },
        );
      }
      if (url.endsWith(`/warehouses/${WH}/products/${P1}/stock`)) {
        return new Response(
          JSON.stringify({
            warehouse_id: WH,
            product_id: P1,
            physical_stock: 120,
            reserved_stock: reservedStock,
            available_stock: 120 - reservedStock,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith(`/warehouses/${WH}/stock`)) {
        return new Response(JSON.stringify(stockJSON), { status: 200 });
      }
      if (url.endsWith("/reservations") && init?.method === "POST") {
        reservedStock = 3;
        return new Response(
          JSON.stringify({
            id: "11111111-2222-4333-8444-555555555555",
            warehouse_id: WH,
            status: "pending",
            created_at: "2026-10-28T02:00:00Z",
            expires_at: "2026-10-28T02:15:00Z",
            items: [{ product_id: P1, quantity: 3 }],
          }),
          { status: 201 },
        );
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    expect(await screen.findByText("In stock")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create reservation" }));
    fireEvent.change(screen.getByLabelText("Product for line"), { target: { value: P1 } });
    fireEvent.change(screen.getByLabelText("Quantity for line"), { target: { value: "3" } });
    fireEvent.submit(document.getElementById("create-reservation-form") as HTMLFormElement);

    expect(await screen.findByText("3 reserved · 117 available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to inventory" }));

    const row = await screen.findByRole("row", { name: /Widget/ });
    expect(within(row).getByRole("cell", { name: "120" })).toBeTruthy();
    expect(within(row).getByRole("cell", { name: "3" })).toBeTruthy();
    expect(within(row).getByRole("cell", { name: "117" })).toBeTruthy();
  });

  it("shows an actionable error when stock cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        throw new TypeError("Failed to fetch");
      }),
    );

    renderPage();

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((alert) => alert.textContent?.includes("could not be loaded"))).toBe(true);
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  });

  it("marks a product that is not stocked instead of failing the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: RequestInfo | URL, _init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/warehouses")) {
            return new Response(JSON.stringify([{ id: WH, name: "Main warehouse" }]), { status: 200 });
          }
          if (url.endsWith("/products")) {
            return new Response(JSON.stringify([{ id: P1, sku: "SKU-01", name: "Widget" }]), {
              status: 200,
            });
          }
          return new Response(
            JSON.stringify({ error: { code: "not_found", message: "no stock row" } }),
            { status: 404 },
          );
        },
      ),
    );

    renderPage();

    expect(await screen.findByText("Not stocked in this warehouse")).toBeTruthy();
    // A single missing row must not raise a page-level error.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a removed catalog product hidden after refreshing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/warehouses")) {
        return new Response(JSON.stringify([{ id: WH, name: "Main warehouse" }]), { status: 200 });
      }
      if (url.endsWith("/products")) {
        return new Response(JSON.stringify([{ id: P1, sku: "SKU-01", name: "Widget" }]), {
          status: 200,
        });
      }
      return new Response(JSON.stringify(stockJSON), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    expect(await screen.findByText("In stock")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Stop tracking ${P1}` }));
    expect(await screen.findByText("No products tracked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.queryByText("Widget")).toBeNull());
    expect(localStorage.getItem("depot-hidden-products")).toContain(P1);
  });
});
