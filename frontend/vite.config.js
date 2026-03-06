import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
    cssCodeSplit: true,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        entryFileNames: "assets/js/[name]-[hash].js",
        chunkFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: ({ name }) => {
          if (!name) {
            return "assets/[name]-[hash][extname]";
          }
          if (name.endsWith(".css")) {
            return "assets/css/[name]-[hash][extname]";
          }
          return "assets/[name]-[hash][extname]";
        },
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("recharts")) {
            return "vendor-charts";
          }
          if (
            id.includes("react") ||
            id.includes("react-dom") ||
            id.includes("scheduler")
          ) {
            return "vendor-react";
          }
          if (id.includes("axios") || id.includes("date-fns")) {
            return "vendor-utils";
          }
          return "vendor";
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    fs: {
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, "..", "docs"),
      ],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
