import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, getInitialTheme } from "./theme";
import "./styles.css";

// Re-apply the resolved theme (same decision as the inline script in
// index.html) so hydration and the first render agree — no theme flash.
applyTheme(getInitialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
