import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxy = {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { ...apiProxy },
  },
  // `vite preview` does not use `server.proxy` unless mirrored here — otherwise /api/* hits the preview server and 404s.
  preview: {
    proxy: { ...apiProxy },
  },
})
