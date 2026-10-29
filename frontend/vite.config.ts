// vite.config.ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000';
  // API requests may deliberately target Laravel's front controller
  // (`.../index.php`), but static uploads live beside it in `/storage`.
  // Forwarding `/storage` to the front controller turns a file request into
  // the SPA HTML document, which can then be mistakenly used as quiz text.
  const assetTarget = env.VITE_ASSET_URL || apiTarget.replace(/\/index\.php\/?$/, '');
  const legacyTarget = env.VITE_LEGACY_PROXY_TARGET;
  const base = env.VITE_BASE || './';
  const hmrHost = env.VITE_HMR_HOST?.trim();

  const proxy: Record<string, { target: string; changeOrigin: boolean; secure: boolean; rewrite?: (path: string) => string }> = {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
      secure: false,
    },
  };

  // Keep local uploaded files on the Vite origin during development. Without
  // this proxy, requests from :5173 to Apache's /storage directory are blocked
  // by the browser's CORS policy when selecting a file from the study bag.
  proxy['/storage'] = {
    target: assetTarget,
    changeOrigin: true,
    secure: false,
  };

  if (legacyTarget) {
    proxy['/legacy-api'] = {
      target: legacyTarget,
      changeOrigin: true,
      secure: false,
      rewrite: path => path.replace(/^\/legacy-api/, ''),
    };
  }

  return {
    base,
    plugins: [react()],
    build: { outDir: '../public/app', emptyOutDir: true },

    server: {
      port: 5173,
      host: true,
      // allow access through the cloudflared quick tunnel
      allowedHosts: ['.trycloudflare.com'],
      hmr: hmrHost
        ? { protocol: 'wss', host: hmrHost, clientPort: 443 }
        : undefined,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      },
      proxy,
    },
  };
});
