/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { ocrAssets } from './vite.ocr-assets.ts'

const THEME_COLOR = '#0d4f68'
const BACKGROUND_COLOR = '#ffffff'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ocrAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Vita Family',
        short_name: 'Vita Family',
        description: 'Organize, acompanhe e gira a saúde individual e familiar.',
        lang: 'pt-PT',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: THEME_COLOR,
        background_color: BACKGROUND_COLOR,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell offline; dados (futura API) nunca são guardados em cache.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,webp,woff2}'],
        // Só os subconjuntos latinos da fonte são necessários em pt-PT.
        // O motor de leitura de fotos (M16) pesa vários MB: não entra na pré-carga, vai para cache na 1.ª utilização.
        // Handlers push/notificationclick (UC-ALR-06): importados pelo service worker gerado e nunca pré-guardados,
        // para que uma alteração chegue com a atualização do sw.js (o browser também compara os scripts importados).
        importScripts: ['push-sw.js'],
        globIgnores: ['push-sw.js', '**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2', 'ocr/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'vita-ocr', expiration: { maxEntries: 8 }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Mesma origem que em produção (infrastructure.md: Traefik encaminha /api -> api):
    // evita CORS em dev sem abrir a API a outras origens.
    proxy: { '/api': { target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8081', changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Os testes de fluxo montam o router inteiro; com a máquina carregada passavam dos 5 s por omissão.
    testTimeout: 30000,
  },
})
