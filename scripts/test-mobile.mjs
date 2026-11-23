import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const basePath = '/curriculum-inquiry-app';
const outputDir = resolve('out');
const nextBin = resolve('node_modules/next/dist/bin/next');
const env = { ...process.env,
  NEXT_PUBLIC_GENERATION_API_URL: 'https://worker.example.invalid/generate',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'test-public-site-key',
};

async function runBuild() {
  await new Promise((resolveDone, reject) => {
    const child = spawn(process.execPath, [nextBin, 'build'], { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveDone() : reject(new Error(`next build failed (${code})`)));
  });
  await stat(resolve(outputDir, 'index.html'));
}

await runBuild();
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(basePath)) { response.writeHead(404).end(); return; }
    let relative = pathname.slice(basePath.length).replace(/^\/+/, '');
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const file = resolve(outputDir, relative);
    if (file !== outputDir && !file.startsWith(outputDir + sep)) { response.writeHead(400).end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const child = spawn(process.execPath, ['tests/mobile-browser.mjs'], {
    env: { ...env, BROWSER_TEST_URL: `http://127.0.0.1:${server.address().port}${basePath}/` },
    stdio: 'inherit',
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) process.exitCode = code ?? 1;
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise(done => server.close(done));
}
