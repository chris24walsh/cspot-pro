import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
import { defineConfig } from "vite";

function normalizeBasePath(path: string) {
  if (!path || path === "/") {
    return "/";
  }

  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

const appBasePath = normalizeBasePath(process.env.VITE_APP_BASE_PATH || "/");

export default defineConfig({
  base: appBasePath,
  plugins: [react(), legacy({ targets: ["defaults", "ios >= 12", "safari >= 12"] })],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
