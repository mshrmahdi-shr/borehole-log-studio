import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: { strictPort: true, port: 1420 },
  envPrefix: ['VITE_', 'TAURI_'],
  build: { target: ['es2021', 'chrome105', 'safari13'] }
});
