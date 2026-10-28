import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CreateReservationModal from "./CreateReservationModal";
import { ToastsProvider } from "./Toasts";
import type { Reservation, Stock } from "../api/types";

const WH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const reservationFixture: Reservation = {
  id: "11111111-2222-4333-8444-555555555555",
  warehouse_id: WH,
  status: "pending",
  created_at: "2026-10-28T02:00:00Z",
  expires_at: "2026-10-28T02:15:00Z",
  items: [{ product_id: P1, quantity: 3 }],
};

const stockFixture: Record<string, Stock> = {
  [P1]: { warehouse_id: WH, product_id: P1, physical_stock: 100, reserved_stock: 0, available_stock: 100 },
};

function renderModal() {
  const props = {
    warehouseId: WH,
    products: [P1, P2],
    stockByProduct: stockFixture,
    onClose: vi.fn(),
    onCreated: vi.fn(),
    onOpenDetails: vi.fn(),
  };
  const view = render(
    <ToastsProvider>
      <CreateReservationModal {...props} />
    </ToastsProvider>,
  );
  return { ...view, props };
}

const form = () => document.getElementById("create-reservation-form") as HTMLFormElement;

function selectProduct(lineIndex: number, value: string) {
  const selects = screen.getAllByLabelText("Product for line");
  fireEvent.change(selects[lineIndex], { target: { value } });
}

function enterQuantity(value: string) {
  const input = screen.getAllByLabelText("Quantity for line")[0];
  fireEvent.change(input, { target: { value } });
}

describe("CreateReservationModal", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("blocks submission while a line is incomplete", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { props } = renderModal();

    fireEvent.submit(form());

    expect(await screen.findByText("Select a product.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(props.onCreated).not.toHaveBeenCalled();
  });

  it("rejects duplicate products consistently with the backend contract", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { props } = renderModal();

    selectProduct(0, P1);
    enterQuantity("2");
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    selectProduct(1, P1);
    fireEvent.change(screen.getAllByLabelText("Quantity for line")[1], { target: { value: "3" } });

    fireEvent.submit(form());

    expect(await screen.findByText(/Duplicate product/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(props.onCreated).not.toHaveBeenCalled();
  });

  it("creates the reservation with one idempotency key and shows the result", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (String(input).endsWith(`/warehouses/${WH}/products/${P1}/stock`)) {
          return new Response(
            JSON.stringify({
              warehouse_id: WH,
              product_id: P1,
              physical_stock: 100,
              reserved_stock: 3,
              available_stock: 97,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(reservationFixture), { status: 201 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { props } = renderModal();

    selectProduct(0, P1);
    enterQuantity("3");
    fireEvent.submit(form());

    await waitFor(() => expect(props.onCreated).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8080/reservations");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      warehouse_id: WH,
      items: [{ product_id: P1, quantity: 3 }],
    });
    const key = (init?.headers as Record<string, string>)["Idempotency-Key"];
    expect(key).toMatch(/^[0-9a-f-]{36}$/i);

    // Success view with the created reservation.
    expect(await screen.findByText("Reservation created")).toBeTruthy();
    expect(screen.getAllByText(reservationFixture.id).length).toBeGreaterThan(0);
    expect(await screen.findByText("3 reserved · 97 available")).toBeTruthy();
    expect(screen.getByText(/Physical stock stays the same/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to inventory" })).toBeTruthy();
  });

  it("keeps the same idempotency key when retrying the unchanged payload", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ error: { code: "timeout", message: "The request timed out." } }),
          { status: 504 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderModal();

    selectProduct(0, P1);
    enterQuantity("3");
    fireEvent.submit(form());

    // First attempt fails; the payload is unchanged for the retry.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("timeout");

    fireEvent.submit(form());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const keyOf = (i: number) =>
      (fetchMock.mock.calls[i][1]?.headers as Record<string, string>)["Idempotency-Key"];
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it("surfaces backend error codes and messages (insufficient stock)", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            error: {
              code: "insufficient_stock",
              message: "product bbbbbbbb has available 2, requested 5: insufficient stock",
            },
          }),
          { status: 409 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderModal();

    selectProduct(0, P1);
    enterQuantity("5");
    fireEvent.submit(form());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("insufficient_stock");
    expect(alert.textContent).toContain("available 2, requested 5");
    // The form stays open so the user can adjust the quantity.
    expect(screen.getByRole("button", { name: "Create reservation" })).toBeTruthy();
  });
});
