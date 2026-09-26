import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, workspaceRoot, "VITE_");
  const apiProxyTarget =
    process.env.VITE_API_PROXY_TARGET ??
    environment.VITE_API_PROXY_TARGET ??
    "http://127.0.0.1:3000";
  const devServerPort = Number(
    process.env.VITE_PORT ?? environment.VITE_PORT ?? 5173,
  );

  return {
    envDir: workspaceRoot,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: devServerPort,
      strictPort: true,
      proxy: {
        "/api": apiProxyTarget,
        "/health": apiProxyTarget,
        "/sub": apiProxyTarget,
      },
    },
  };
});
