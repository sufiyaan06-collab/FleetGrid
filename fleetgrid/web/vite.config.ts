import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const backend = env.VITE_BACKEND_ORIGIN ?? '';

  return {
    plugins: [react()],
    optimizeDeps: {
      include: ['@googlemaps/js-api-loader'],
    },
    server: {
      port: Number(env.VITE_PORT ?? 5173),
      host: true,
    },
    preview: {
      port: Number(env.VITE_PREVIEW_PORT ?? 4173),
      host: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
    define: {
      // Prefer an explicitly configured API origin; otherwise let the client
      // resolve the deployed site's own origin (localhost:4000 is dev-only).
      __FLEETGRID_BACKEND__: JSON.stringify(env.VITE_API_URL ?? backend),
    },
  };
});
