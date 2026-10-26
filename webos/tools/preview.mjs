// Serves the built app over http for a desktop browser, as a stand-in for the TV:
// no webOS services, so the microphone engine shows as unavailable.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'dist', 'app');
const port = Number(process.env.PORT || 5199);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}/`));
