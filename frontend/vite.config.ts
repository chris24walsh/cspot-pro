import react from "@vitejs/plugin-react";
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
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
