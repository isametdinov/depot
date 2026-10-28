import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ReservationsPage from "./ReservationsPage";
import { ToastsProvider } from "../components/Toasts";

const WH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RID = "11111111-2222-4333-8444-555555555555";

const pendingRes = {
  id: RID,
  warehouse_id: WH,
  status: "pending",
  created_at: "2026-10-28T02:00:00Z",
  expires_at: "2026-10-28T02:15:00Z",
  items: [{ product_id: P1, quantity: 4 }],
};

const confirmedRes = { ...pendingRes, status: "confirmed" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function renderPage(initialLookupId = "") {
  return render(
    <ToastsProvider>
      <ReservationsPage initialLookupId={initialLookupId} />
    </ToastsProvider>,
  );
}

const lookupForm = () => document.querySelector(".lookup-form") as HTMLFormElement;

describe("ReservationsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("looks up a reservation and shows its details from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(pendingRes)),
    );

    renderPage();
    fireEvent.change(screen.getByLabelText("Reservation ID"), { target: { value: RID } });
    fireEvent.submit(lookupForm());

    expect(await screen.findByText(RID)).toBeTruthy();
    expect(screen.getByText("pending")).toBeTruthy();
    expect(screen.getByText(P1.slice(0, 8) + "…")).toBeTruthy(); // item line
    // Pending reservations offer both actions.
    expect(screen.getByRole("button", { name: /confirm reservation/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /cancel reservation/i })).toBeTruthy();
  });

  it("reports unknown reservation ids as a readable lookup error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({ error: { code: "not_found", message: "reservation not found" } }, 404),
      ),
    );

    renderPage();
    fireEvent.change(screen.getByLabelText("Reservation ID"), { target: { value: RID } });
    fireEvent.submit(lookupForm());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No reservation with id");
  });

  it("confirms a pending reservation behind the dialog and updates state", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResponse(confirmedRes);
      return jsonResponse(pendingRes); // lookup + any refresh
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage(RID); // auto-lookup on mount
    expect(await screen.findByRole("button", { name: /confirm reservation/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /confirm reservation/i }));

    // Confirmation dialog appears.
    const dialog = await screen.findByRole("dialog", { name: "Confirm reservation?" });
    expect(within(dialog).getByText(/releases its stock hold/i)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith(`/reservations/${RID}/confirm`) && init?.method === "POST",
        ),
      ).toBe(true),
    );

    // State transition reflected: confirmed badge, actions removed, success toast.
    expect(await screen.findByText("confirmed")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /confirm reservation/i })).toBeNull(),
    );
    expect(await screen.findByText(/is now confirmed/)).toBeTruthy();
  });

  it("shows the backend's conflict response when a transition is rejected", async () => {
    let getCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        return jsonResponse(
          {
            error: {
              code: "invalid_transition",
              message: "reservation is confirmed, cannot move to cancelled: invalid state transition",
            },
          },
          409,
        );
      }
      // First lookup: pending. The post-error refresh: confirmed — exactly
      // what the authoritative backend would report after rejecting cancel.
      void url;
      getCalls++;
      return jsonResponse(getCalls === 1 ? pendingRes : confirmedRes);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage(RID);
    fireEvent.click(await screen.findByRole("button", { name: /cancel reservation/i }));

    const dialog = await screen.findByRole("dialog", { name: "Cancel reservation?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel reservation" }));

    // The backend's error code and message are shown verbatim.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("invalid_transition");
    expect(alert.textContent).toContain("cannot move to cancelled");
    // Details were refreshed from the server afterwards.
    expect(await screen.findByText("confirmed")).toBeTruthy();
  });
});
