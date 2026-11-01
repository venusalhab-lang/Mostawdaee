import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    appType: 'spa',
    build: {
      chunkSizeWarningLimit: 1800,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            // Only group libraries every screen needs; anything else stays with the lazy screen that imports it.
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
            if (id.includes('/@supabase/')) return 'supabase';
          }
        }
      }
    },
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        workbox: {
          // Skip workbox terser minify — its worker can abort the whole Vite build in CI/sandboxes.
          mode: 'development',
          disableDevLogs: true,
          maximumFileSizeToCacheInBytes: 4000000,
          navigateFallback: './index.html',
          navigateFallbackDenylist: [/^\/api/, /^\/auth/],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.destination === 'font',
              handler: 'CacheFirst',
              options: {
                cacheName: 'fonts',
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },
        manifest: {
          name: 'مستودعي - Mostawdaee',
          short_name: 'مستودعي',
          description: 'نظام إدارة التجارة والمخزون الذكي',
          theme_color: '#4f46e5',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          scope: './',
          start_url: './',
          icons: [
            {
              src: 'icon.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any'
            },
            {
              src: 'icon.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'maskable'
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
