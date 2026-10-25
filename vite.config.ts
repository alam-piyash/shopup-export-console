import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    // flat output so the build can be uploaded file by file to Vercel
    assetsDir: "",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
          vendor: ["@tanstack/react-query", "@radix-ui/react-dialog", "@radix-ui/react-popover", "sonner"],
        },
      },
    },
  },
});
