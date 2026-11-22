import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';

if (!existsSync('.next/BUILD_ID')) throw Error('Run npm run build before the browser test');

process.env.SUPABASE_URL = 'https://db.example.invalid';
process.env.SUPABASE_ANON_KEY = 'sb_publishable_browser_fixture';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.OPENAI_API_KEY = '';
const { default: next } = await import('next');
const app = next({ dev: false, hostname: '127.0.0.1', quiet: true });
await app.prepare();
const server = createServer(app.getRequestHandler());
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  const child = spawn(process.execPath, ['tests/mobile-browser.mjs'], {
    env: { ...process.env, BROWSER_TEST_URL: url }, stdio: 'inherit',
  });
  const [status] = await once(child, 'exit');
  process.exitCode = status ?? 1;
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await app.close();
}
