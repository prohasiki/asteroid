/**
 * tests/serve.mjs — минимальный статический сервер для локальной проверки.
 *
 * В песочнице CDN недоступен, поэтому при rewriteImportMap=true сервер
 * подменяет адрес Three.js в import map index.html на локальную копию
 * из .test-deps/node_modules/three (устанавливается tests/e2e.mjs).
 * Исходные файлы проекта при этом не изменяются.
 *
 * Запуск вручную:  node tests/serve.mjs [порт]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDN_THREE = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const LOCAL_THREE = '/.test-deps/node_modules/three/';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

export function startServer({ port = 8765, rewriteImportMap = true, quiet = true } = {}) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(ROOT, rel));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (!quiet) console.log('404', rel);
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      let body = fs.readFileSync(file);
      if (ext === '.html' && rewriteImportMap) {
        body = Buffer.from(body.toString('utf8').split(CDN_THREE).join(LOCAL_THREE), 'utf8');
      }
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8765);
  startServer({ port, quiet: false }).then(() => {
    console.log(`Serving ${ROOT} at http://127.0.0.1:${port}/ (import map → local three.js)`);
  });
}
