import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The Dispatch backend (server/server.ts) listens on process.env.PORT, which
// defaults to 3000 (see server/server.ts and .env.example). The frontend dev
// server runs on a different port (Vite's default 5173), so requests to
// /api/* are proxied here rather than calling the backend cross origin, since
// server.ts registers no CORS middleware. VITE_BACKEND_URL overrides the
// proxy target for a locally reconfigured backend port.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:3000';

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
