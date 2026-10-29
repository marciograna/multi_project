import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // Caminhos relativos: funciona no GitHub Pages (/converte-tudo/) ou em qualquer outro host.
  base: './',
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
    rollupOptions: { output: { entryFileNames: 'assets/app-[hash].js' } },
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Converte Tudo',
        short_name: 'Converte Tudo',
        description: 'Converta vídeos, áudios, PDFs, imagens, documentos e planilhas direto no celular.',
        lang: 'pt-BR',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f4fb',
        theme_color: '#7262ae',
        categories: ['utilities', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // Só a "casca" do app vai no cache inicial; bibliotecas pesadas entram no cache quando usadas.
        globPatterns: ['index.html', 'assets/app-*.js', 'assets/*.css', 'icons/*', '*.webmanifest'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Arquivos com hash no nome: nunca mudam.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'converte-tudo-assets', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            // Arquivos sem hash (OCR, fontes do pdf.js): o cache é renovado a cada versão do app.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/(pdfjs|ocr)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: `converte-tudo-libs-${version}`, expiration: { maxEntries: 300 } },
          },
        ],
      },
    }),
  ],
});
