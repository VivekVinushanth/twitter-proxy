import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/2': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
