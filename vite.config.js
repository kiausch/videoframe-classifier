import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import path from 'path'

export default defineConfig({
  plugins: [
      vue(),
      vuetify({ autoImport: true })
    ],
  root: './src',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/images': 'http://localhost:5174',
      '/videos': 'http://localhost:5174'
    }
  }
})
