import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The frontend talks to the Go API at VITE_API_BASE_URL (see .env.example).
// The API sends CORS headers for this origin, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
});
