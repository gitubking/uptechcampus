import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueJsx(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'UPTECH Campus',
        short_name: 'UPTECH',
        description: 'Plateforme de gestion intégrée — UPTECH Campus',
        theme_color: '#E30613',
        background_color: '#111111',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        lang: 'fr',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        categories: ['education', 'productivity', 'business'],
        screenshots: [],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // SPA : on sert index.html (précaché) pour toutes les navigations.
        // L'app démarre depuis le cache, les appels API échouent proprement
        // côté composant → pas d'écran "hors-ligne" intempestif sur
        // un cold-start Vercel ou un micro-hoquet wifi.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/icons/, /^\/offline\.html$/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/uptechcampus\.vercel\.app\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 5, // 5 minutes
              },
              // 30 s : tolère les cold-starts Vercel (jusqu'à ~8 s) + marge
              networkTimeoutSeconds: 30,
            },
          },
          {
            urlPattern: /\.(woff2?|ttf|otf|eot)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          {
            urlPattern: /\.(png|jpe?g|gif|svg|webp|ico)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  build: {
    // 1 MB : on limite la charge d'un seul chunk, les gros libs (xlsx, jspdf, exceljs…)
    // sont isolées via manualChunks ci-dessous et chargées dynamiquement côté vues.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Libs lourdes → chunks dédiés, chargées uniquement quand la vue correspondante est ouverte.
          if (id.includes('exceljs')) return 'vendor-exceljs'
          if (id.includes('xlsx')) return 'vendor-xlsx'
          if (id.includes('jspdf-autotable')) return 'vendor-jspdf-autotable'
          if (id.includes('jspdf')) return 'vendor-jspdf'
          if (id.includes('html2canvas')) return 'vendor-html2canvas'
          if (id.includes('chart.js') || id.includes('vue-chartjs')) return 'vendor-chart'
          if (id.includes('docx-templates') || id.includes('docx')) return 'vendor-docx'
          if (id.includes('qrcode')) return 'vendor-qrcode'
          if (id.includes('dompurify') || id.includes('purify')) return 'vendor-purify'
          // Tronc commun Vue — déjà implicite mais on le nomme pour clarté dans les reports
          if (id.includes('/vue/') || id.includes('@vue/') || id.includes('vue-router') || id.includes('pinia')) {
            return 'vendor-vue'
          }
        },
      },
    },
  },
})
