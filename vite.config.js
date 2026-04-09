import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/viewer',
  publicDir: false,  // we copy static assets via build script
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
