import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const runGit = (args, input) => spawnSync('git', args, { cwd: root, input, encoding: 'utf8' });
const privateSamples = ['sources-private/sample.pdf', 'data-private/sample.json', '.env.local',
  'workers/.dev.vars', 'workers/.wrangler/state/sample', 'out/sample.pdf'];
const ignoredResult = runGit(['check-ignore', '--stdin'], privateSamples.join('\n') + '\n');
const ignored = new Set((ignoredResult.stdout ?? '').trim().split(/\r?\n/));
const trackedResult = runGit(['ls-files', '--', 'sources-private', 'data-private', '.env', '.env.*',
  'workers/.dev.vars', 'workers/.wrangler']);
const trackedPrivate = (trackedResult.stdout ?? '').trim().split(/\r?\n/).filter(Boolean)
  .filter(path => path !== '.env.example');
const untrackedResult = runGit(['ls-files', '--others', '--exclude-standard', '--',
  'sources-private', 'data-private', '.env', '.env.*', 'workers/.dev.vars', 'workers/.wrangler']);
const untrackedPrivate = (untrackedResult.stdout ?? '').trim().split(/\r?\n/).filter(Boolean)
  .filter(path => path !== '.env.example');
const requiredIgnore = privateSamples.filter(path => !ignored.has(path));
if (ignoredResult.status !== 0 || trackedResult.status !== 0 || untrackedResult.status !== 0 ||
    requiredIgnore.length || trackedPrivate.length || untrackedPrivate.length) {
  console.error('Private-data exclusion check failed.');
  if (requiredIgnore.length) console.error('Missing ignore rules for:', requiredIgnore.join(', '));
  if (trackedPrivate.length) console.error('Tracked private paths found:', trackedPrivate.join(', '));
  if (untrackedPrivate.length) console.error('Unignored private paths found:', untrackedPrivate.join(', '));
  process.exit(2);
}

const staticConfig = readFileSync(join(root, 'next.config.mjs'), 'utf8');
const workflow = readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8');
const workerConfig = readFileSync(join(root, 'workers/wrangler.jsonc'), 'utf8');
if (!staticConfig.includes("output: 'export'") || !staticConfig.includes("basePath: '/curriculum-inquiry-app'") ||
    !workflow.includes('actions/deploy-pages') || !workerConfig.includes('GENERATION_LIMITER')) {
  console.error('GitHub Pages or Worker configuration is incomplete.');
  process.exit(2);
}

if (!existsSync(join(root, 'out/index.html'))) {
  console.error('Static artifact missing. Run npm run build first.');
  process.exit(2);
}
const privateName = /(?:textbook-review|teacher[-_]textbook|verified-standard-seed\.sql|\.dev\.vars|service[_-]?role)/iu;
const secretValue = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|OPENAI_API_KEY\s*[:=]\s*[^\s"']{12,}|TURNSTILE_SECRET_KEY\s*[:=]\s*[^\s"']{12,})/u;
const files = [];
const walk = directory => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const rel = relative(join(root, 'out'), path).replaceAll('\\', '/');
    if (privateName.test(rel)) throw new Error(`Private artifact path found: ${rel}`);
    if (statSync(path).isDirectory()) walk(path);
    else {
      files.push(rel);
      const body = readFileSync(path);
      if (body.length < 5_000_000 && secretValue.test(body.toString('utf8'))) {
        throw new Error(`Possible server secret in public artifact: ${rel}`);
      }
    }
  }
};
try {
  walk(join(root, 'out'));
  const artifactCheck = runGit(['status', '--short', '--', 'out']);
  console.log(`Release source check passed. Public artifact contains ${files.length} files; no private catalog or server secret detected.`);
  console.log('Actual Cloudflare/OpenAI connectivity and Pages deployment are not checked by this local command.');
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
