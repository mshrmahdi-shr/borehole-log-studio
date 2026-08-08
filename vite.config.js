import { defineConfig } from 'vite';

const isPages = process.env.DEPLOY_TARGET === 'pages';

export default defineConfig({
  base: isPages ? '/borehole-log-studio/' : '/',
  clearScreen: false,
  server: { strictPort: true, port: 1420 },
  envPrefix: ['VITE_', 'TAURI_'],
  build: { target: ['es2021', 'chrome105', 'safari13'] }
});
