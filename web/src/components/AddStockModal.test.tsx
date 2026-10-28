import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AddStockModal from "./AddStockModal";
import { ToastsProvider } from "./Toasts";

const WH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function renderModal(overrides: Partial<Parameters<typeof AddStockModal>[0]> = {}) {
  const props = {
    warehouseId: WH,
    products: [P1],
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  const view = render(
    <ToastsProvider>
      <AddStockModal {...props} />
    </ToastsProvider>,
  );
  return { ...view, props };
}

const form = () => document.getElementById("add-stock-form") as HTMLFormElement;

describe("AddStockModal", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("validates input without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { props } = renderModal();

    fireEvent.submit(form());

    expect(await screen.findByText("Select a product.")).toBeTruthy();
    expect(
      screen.getByText("Quantity must be a whole number between 0 and 1,000,000."),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it("submits to the real stock endpoint and reports success", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            warehouse_id: WH,
            product_id: P1,
            physical_stock: 100,
            reserved_stock: 0,
            available_stock: 100,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { props } = renderModal();

    fireEvent.change(screen.getByLabelText("Product"), { target: { value: P1 } });
    fireEvent.change(screen.getByLabelText("Set physical quantity"), {
      target: { value: "100" },
    });
    fireEvent.submit(form());

    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(P1));
    expect(props.onClose).toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`http://localhost:8080/warehouses/${WH}/stock`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ product_id: P1, quantity: 100 });

    // Success feedback is visible.
    expect(await screen.findByText(/Stock set to 100/)).toBeTruthy();
  });

  it("prevents duplicate submissions while a request is in flight", async () => {
    let resolveFetch: (r: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => pending);
    vi.stubGlobal("fetch", fetchMock);
    const { props } = renderModal();

    fireEvent.change(screen.getByLabelText("Product"), { target: { value: P1 } });
    fireEvent.change(screen.getByLabelText("Set physical quantity"), {
      target: { value: "5" },
    });
    fireEvent.submit(form());

    const busyButton = await screen.findByRole("button", { name: "Saving…" });
    expect((busyButton as HTMLButtonElement).disabled).toBe(true);
    // A second submit while pending must not fire another request.
    fireEvent.submit(form());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(
      new Response(
        JSON.stringify({
          warehouse_id: WH,
          product_id: P1,
          physical_stock: 5,
          reserved_stock: 0,
          available_stock: 5,
        }),
        { status: 200 },
      ),
    );
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  });
});
