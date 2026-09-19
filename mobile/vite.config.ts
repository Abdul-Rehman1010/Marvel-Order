import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const mobileDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(mobileDirectory, "..");

export default defineConfig({
  root: mobileDirectory,
  base: "./",
  envDir: mobileDirectory,
  publicDir: path.resolve(projectDirectory, "public"),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(projectDirectory, "src"),
      "next/image": path.resolve(mobileDirectory, "src/next-image.tsx"),
    },
  },
  server: {
    fs: {
      allow: [projectDirectory],
    },
  },
  build: {
    outDir: path.resolve(projectDirectory, "mobile-dist"),
    emptyOutDir: true,
  },
});
