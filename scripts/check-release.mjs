import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const root = new URL('../', import.meta.url);
const live = process.argv.includes('--live');
const settings = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL'];
const privatePaths = ['sources-private/curriculum/sample.zip', 'data-private/textbook-review/sample.txt', '.env.local'];
const git = spawnSync('git', ['check-ignore', '--stdin'], {
  cwd: root, input: privatePaths.join('\n') + '\n', encoding: 'utf8',
});
const ignored = new Set(git.stdout?.trim().split(/\r?\n/) ?? []);
const tracked = spawnSync('git', ['ls-files', 'sources-private', 'data-private', '.env', '.env.*'], {
  cwd: root, encoding: 'utf8',
});
const trackedPrivate = tracked.stdout?.trim().split(/\r?\n/).filter(path => path && path !== '.env.example') ?? [];
const unignored = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--',
  'sources-private', 'data-private', 'video/out', 'test-results', '.env', '.env.*'], {
  cwd: root, encoding: 'utf8',
});
const unignoredPrivate = unignored.stdout?.trim().split(/\r?\n/).filter(path => path && path !== '.env.example') ?? [];
const vercelIgnore = new Set(readFileSync(new URL('.vercelignore', root), 'utf8').trim().split(/\r?\n/));
if (tracked.status !== 0 || unignored.status !== 0 || privatePaths.some(path => !ignored.has(path)) ||
    trackedPrivate.length || unignoredPrivate.length ||
    ['sources-private/', 'data-private/', '.env*', 'video/', 'test-results/'].some(path => !vercelIgnore.has(path))) {
  console.error('Private source exclusion check failed.');
  process.exit(2);
}
console.log('Git private paths are ignored and untracked. Vercel exclusion rules are present.');

nextEnv.loadEnvConfig(fileURLToPath(root), false);
const missing = settings.filter(name => !process.env[name]?.trim());
const linked = existsSync(new URL('.vercel/project.json', root));
console.log('Vercel local project link:', linked ? 'present' : 'not found');
if (missing.length) {
  console.error('Missing connection settings:', missing.join(', '));
  process.exitCode = 1;
} else {
  const invalid = [];
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service } = process.env;
  const parsed = URL.parse(url);
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) invalid.push('SUPABASE_URL');
  let anonRole;
  try {
    anonRole = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url').toString()).role;
  } catch { /* A publishable key is not a JWT. */ }
  if (anon === service || (!anon.startsWith('sb_publishable_') && anonRole !== 'anon')) {
    invalid.push('SUPABASE_ANON_KEY');
  }
  const limit = Number(process.env.LESSON_GENERATION_DAILY_LIMIT ?? 10);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) invalid.push('LESSON_GENERATION_DAILY_LIMIT');
  if (invalid.length) {
    console.error('Invalid connection settings:', invalid.join(', '));
    process.exitCode = 1;
  } else {
    console.log('Connection settings passed local validation.');
    if (!live) {
      console.log('Live connectivity has not been checked. Use --live for read-only probes.');
    } else {
      const probes = [
        ['Supabase verified standards', async () => {
          const endpoint = new URL('/rest/v1/curriculum_standards', parsed);
          endpoint.search = new URLSearchParams({ select: 'code', curriculum: 'eq.2022', verified: 'eq.true', limit: '1' });
          const response = await fetch(endpoint, { method: 'HEAD', redirect: 'error',
            headers: { apikey: service, authorization: 'Bearer ' + service, prefer: 'count=exact' },
            signal: AbortSignal.timeout(8000) });
          if (!response.ok) return 'HTTP ' + response.status;
          const count = response.headers.get('content-range')?.split('/').at(-1);
          return count === '87' ? null : 'expected 87 verified rows';
        }],
        ['OpenAI model access', async () => {
          const model = encodeURIComponent(process.env.OPENAI_MODEL.trim());
          const response = await fetch('https://api.openai.com/v1/models/' + model, {
            headers: { authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, redirect: 'error',
            signal: AbortSignal.timeout(8000) });
          await response.body?.cancel();
          return response.ok ? null : 'HTTP ' + response.status;
        }],
      ];
      const results = await Promise.all(probes.map(async ([label, probe]) => {
        const error = await probe().catch(() => 'request failed');
        console.log(label + ': ' + (error ?? 'pass'));
        return error;
      }));
      if (results.some(Boolean)) process.exitCode = 1;
      console.log('Read-only probes do not verify teacher authentication, generation, or deployment.');
    }
  }
}
