import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The same web build runs in Electron (file://), Android/Fire TV and iOS (Capacitor),
// so every asset path must be relative.
export default defineConfig({
  root: 'src',
  base: './',
  publicDir: 'public', // config.js is copied as-is so the cloud build can fill in keys
  plugins: [preact()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020', // Fire OS 7+ WebViews are Chromium 80 or newer
    sourcemap: true,
  },
  server: { port: 5173 },
});
