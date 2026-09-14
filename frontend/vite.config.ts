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
  plugins: [react(), legacy({
    targets: ["defaults", "ios >= 12", "safari >= 12"],
    // Safari 12 passes the module feature check and uses the modern bundle.
    // It still needs APIs such as Object.fromEntries and Array.flatMap.
    modernTargets: ["edge >= 79", "firefox >= 67", "chrome >= 64", "safari >= 12", "ios >= 12"],
    modernPolyfills: true,
  })],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
