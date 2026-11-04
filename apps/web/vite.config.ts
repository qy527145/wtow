import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// .env 统一放在仓库根目录，前后端共用一份。
const rootDir = fileURLToPath(new URL("../..", import.meta.url));

/** 相对本文件解析路径。 */
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, "");
  // 开发时把 API 与下载链路代理到本地服务端，保持同源以便携带会话 Cookie。
  const target = env.WTOW_DEV_BACKEND ?? `http://${env.WTOW_BIND ?? "127.0.0.1:8080"}`;

  return {
    envDir: rootDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        { find: "@/", replacement: local("./src/") },
        { find: /^@wtow\/ui$/, replacement: local("../../packages/ui/src/index.ts") },
        { find: "@wtow/ui/", replacement: local("../../packages/ui/src/") },
        { find: "@wtow/shared", replacement: local("../../packages/shared/src/index.ts") },
      ],
    },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: {
        "/api": target,
        "/install.sh": target,
        "/install.ps1": target,
        "/dl": target,
        "/download": target,
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // 第三方依赖单独成块：业务代码改动时浏览器仍能命中依赖缓存。
      rolldownOptions: {
        output: {
          advancedChunks: {
            groups: [{ name: "vendor", test: /node_modules/ }],
          },
        },
      },
    },
  };
});
