import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    watch: {
      ignored: ['**/server/data/**'],
    },
    proxy: {
      '/api': 'http://localhost:3000',
      '/downloads': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        configure: (proxy) => {
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            setImmediate(() => {
              socket.removeAllListeners('error')
              socket.on('error', () => {})
            })
          })
        },
      },
    },
  },
})
