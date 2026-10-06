import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8001',
    changeOrigin: true,
    // Allow up to 3 minutes for AI extraction calls
    proxyTimeout: 180_000,
    timeout: 180_000,
    // Auto-reconnect if backend restarts mid-session
    configure: (proxy: any) => {
      proxy.on('error', (err: any, _req: any, res: any) => {
        console.warn('[vite-proxy] Backend unreachable:', err.message);
        if (!res.headersSent) {
          res.writeHead?.(503, { 'Content-Type': 'application/json' });
          res.end?.(JSON.stringify({ detail: 'Backend is restarting \u2014 please retry in a moment.' }));
        }
      });
    },
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    // Allow any tunnel hostnames (*.trycloudflare.com, ngrok, local LAN)
    allowedHosts: true,
    proxy: apiProxy,
  },
  preview: {
    port: 5174,
    strictPort: true,
    host: true,
    // Allow any tunnel hostnames (*.trycloudflare.com, ngrok, local LAN)
    allowedHosts: true,
    proxy: apiProxy,
  },
})

