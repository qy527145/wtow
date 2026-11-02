import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发时把 API 与下载链路代理到本地服务端，保持同源以便携带会话 Cookie。
const target = process.env.WTOW_DEV_BACKEND ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],
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
