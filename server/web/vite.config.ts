import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 开发时把 API 与下载链路代理到本地服务端，保持同源以便携带会话 Cookie。
const target = process.env.WTOW_DEV_BACKEND ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 第三方依赖单独成块：业务代码改动时浏览器仍能命中依赖缓存。
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [{ name: 'vendor', test: /node_modules/ }],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/install.sh': target,
      '/dl': target,
      '/download': target,
    },
  },
})
