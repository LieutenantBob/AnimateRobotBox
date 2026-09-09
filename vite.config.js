import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

// Mime types for static assets
const mimeTypes = {
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function serveProjectRoot() {
  return {
    name: 'serve-project-root',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/config/') && !req.url.startsWith('/assets/')) {
          return next();
        }
        const safePath = path.normalize(req.url).replace(/^(\.\.[/\\])+/, '');
        const filePath = path.join(projectRoot, safePath);
        if (!filePath.startsWith(projectRoot)) return next();
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return next();
        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        fs.createReadStream(filePath).pipe(res);
      });
    },
    closeBundle() {
      // Copy config/ and assets/ into dist/ for production builds
      const distDir = path.join(projectRoot, 'dist');
      const dirs = ['config', 'assets'];
      for (const dir of dirs) {
        const src = path.join(projectRoot, dir);
        const dest = path.join(distDir, dir);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }
    },
  };
}

export default defineConfig({
  root: 'src/viewer',
  publicDir: false,
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [projectRoot],
    },
  },
  plugins: [serveProjectRoot()],
});
