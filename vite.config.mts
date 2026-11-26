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
    target: ['es2019', 'chrome80'], // TV WebViews can be as old as Chromium 80
    cssTarget: ['chrome80'],
    sourcemap: true,
  },
  server: { port: 5173 },
});
