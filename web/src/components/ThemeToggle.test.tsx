import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ThemeToggle from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute("data-theme", "dark");
  });

  // Vitest globals are off, so React Testing Library cannot self-register
  // its cleanup — do it explicitly.
  afterEach(cleanup);

  it("switches the document to light mode and persists the choice", () => {
    render(<ThemeToggle />);

    const button = screen.getByRole("button", { name: /switch to light mode/i });
    fireEvent.click(button);

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("depot-theme")).toBe("light");

    // The accessible label flips with the state.
    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeTruthy();
  });

  it("respects the stored explicit choice on load", () => {
    localStorage.setItem("depot-theme", "light");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeTruthy();
  });
});
