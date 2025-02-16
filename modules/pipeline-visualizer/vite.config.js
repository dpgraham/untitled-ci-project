/* eslint-disable */
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: '../pipeline-runner/dist/',
    emptyOutDir: true,
  },
  css: {
    preprocessorOptions: {
      scss: {
        // example: additionalData: `@import "./src/design/styles/variables";` // If you have global SCSS variables
      },
    },
  },
});
