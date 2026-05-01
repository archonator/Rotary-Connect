import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
  build: {
    // Splittet das Bundle in drei Chunks, damit das initiale Render
    // nicht erst auf den (großen) nostr-tools-Code warten muss:
    //   • react-vendor — React + Router (ändert sich selten, gut cachebar)
    //   • nostr        — nostr-tools (~150 KB durch secp256k1)
    //   • app          — alles andere (unser eigentlicher Code)
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('nostr-tools') || id.includes('@noble')) return 'nostr'
            if (id.includes('react') || id.includes('lucide')) return 'react-vendor'
          }
          return undefined
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      manifest: {
        name: 'Rotary Connect',
        short_name: 'RotaryConnect',
        description: 'Connecting Rotarians worldwide. Private. Decentralized. No server.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0e14',
        theme_color: '#003366',
        orientation: 'portrait-primary',
        lang: 'en',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: '/logo.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        categories: ['communication', 'social'],
      },
    }),
  ],
})