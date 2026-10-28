import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DashboardPage from "./DashboardPage";

const WAREHOUSE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("DashboardPage", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("shows a live inventory overview and links to the app workflows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/warehouses")) {
          return new Response(JSON.stringify([{ id: WAREHOUSE_ID, name: "Main warehouse" }]), {
            status: 200,
          });
        }
        if (url.endsWith("/products")) {
          return new Response(
            JSON.stringify([{ id: PRODUCT_ID, sku: "SKU-01", name: "Widget" }]),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            warehouse_id: WAREHOUSE_ID,
            product_id: PRODUCT_ID,
            physical_stock: 12,
            reserved_stock: 2,
            available_stock: 10,
          }),
          { status: 200 },
        );
      }),
    );
    const onOpenInventory = vi.fn();
    const onOpenReservations = vi.fn();

    render(
      <DashboardPage
        onOpenInventory={onOpenInventory}
        onOpenReservations={onOpenReservations}
      />,
    );

    expect((await screen.findAllByText("Main warehouse")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Widget")).toBeTruthy();
    expect(screen.getAllByText("10", { selector: "strong" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("2", { selector: "strong" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /stock that moves/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open inventory" }));
    fireEvent.click(screen.getByRole("button", { name: "View reservations" }));
    expect(onOpenInventory).toHaveBeenCalledOnce();
    expect(onOpenReservations).toHaveBeenCalledOnce();
  });
});
