import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve('out');
await stat(join(root, 'index.html'));
await stat(join(root, '.nojekyll'));
const html = await readFile(join(root, 'index.html'), 'utf8');
assert.match(html, /\/curriculum-inquiry-app\/_next\//u, 'HTML assets must include the Pages subpath');

const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else files.push(full);
  }
}
await walk(root);
assert.ok(files.length > 0);
assert.ok(!files.some(path => /(?:sources-private|data-private|textbook-review|workers[\\/])/iu.test(path)));

const forbidden = [
  /sk-[A-Za-z0-9_-]{20,}/u,
  /OPENAI_API_KEY/u,
  /SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY)/u,
  /approved_summary/u,
  /printed_page_start/u,
];
for (const file of files) {
  const extension = extname(file).toLowerCase();
  if (!['.html', '.js', '.css', '.json', '.txt', '.svg'].includes(extension)) continue;
  const contents = await readFile(file, 'utf8');
  for (const pattern of forbidden) assert.doesNotMatch(contents, pattern, `Forbidden material found in ${file}`);
}

const standardsPath = join(root, 'data', 'standards.json');
const standards = JSON.parse(await readFile(standardsPath, 'utf8'));
assert.equal(standards.length, 87);
assert.ok(standards.every(row => row.curriculum === '2022' && row.verified === true &&
  typeof row.official_source === 'string' && typeof row.official_text === 'string'));
assert.ok(standards.every(row => !Object.keys(row).some(key => /textbook|page|approved_summary/iu.test(key))));
console.log(`Pages artifact check passed: ${files.length} files, 87 official 2022 standards, no textbook catalog or server secrets.`);
