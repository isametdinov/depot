export type Theme = "dark" | "light";

const STORAGE_KEY = "depot-theme";

/** Stored explicit choice, or null when the user never toggled. */
export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Theme for this visit: the stored explicit choice, otherwise the OS
 * preference (night mode is the default when the OS expresses no opinion).
 */
export function getInitialTheme(): Theme {
  const stored = getStoredTheme();
  if (stored) return stored;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Apply the theme to the document (no storage side effects). */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

/** Persist an explicit user choice. */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable — the theme still applies for this visit */
  }
}
