import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // sql.js ships a prebuilt .wasm; keep it out of Vite's dep optimizer.
  optimizeDeps: { exclude: ['sql.js'] },
})
