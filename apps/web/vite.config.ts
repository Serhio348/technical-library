import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api/library": {
        target: "http://127.0.0.1:3021",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:3021",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
