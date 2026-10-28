import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

describe("App shell", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("provides dashboard navigation and contact details in the shared footer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
    render(<App />);

    expect(await screen.findByRole("heading", { name: /stock that moves/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: "94 125 11 28" }).getAttribute("href")).toBe(
      "tel:941251128",
    );
    expect(screen.getByText("Marcus")).toBeTruthy();
    expect(screen.getByText("Tashkent, Uzbekistan")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Inventory$/ }));
    expect(await screen.findByRole("heading", { name: "Inventory" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to dashboard" }));
    expect(await screen.findByRole("heading", { name: /stock that moves/i })).toBeTruthy();
  });

  it("switches the app to Russian and keeps the selected language across navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
    render(<App />);

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "ru" },
    });

    expect(await screen.findByRole("button", { name: "Склад" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Связаться с нами" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "94 125 11 28" }).getAttribute("href")).toBe(
      "tel:941251128",
    );

    fireEvent.click(screen.getByRole("button", { name: "Склад" }));
    expect(await screen.findByRole("heading", { name: "Склад" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("ru");
    expect(localStorage.getItem("depot-language")).toBe("ru");
  });
});
