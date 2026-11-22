import { mkdir, writeFile } from 'node:fs/promises';

const commit = '964bfaef6e02781359288a6c1f55240bfb9c439d';
const repository = 'raphysicst-create/korean-secondary-learning-map-mcp';
const path = 'data/kr/standard-texts.json';
const response = await fetch(`https://raw.githubusercontent.com/${repository}/${commit}/${path}`, {
  signal: AbortSignal.timeout(20000),
});
if (!response.ok) throw new Error(`Upstream download failed (${response.status})`);
const upstream = await response.json();
const rows = upstream.texts.filter(row => row.key.startsWith('kr-2022-middle-과학:'));
if (!rows.length) throw new Error('No middle school science standards found');
const codes = new Set();
for (const row of rows) {
  if (!/^\[9과\d{2}-\d{2}\]$/.test(row.code) || !row.text?.trim() || codes.has(row.code)) {
    throw new Error(`Unexpected or duplicate standard: ${row.code}`);
  }
  codes.add(row.code);
}
const candidates = rows.map(row => ({
  code: row.code,
  candidate_text: row.text,
  upstream_source_id: row.sourceId,
  upstream_locator: row.locator,
  dataset_commit: commit,
  curriculum: '2022',
  official_source: '',
  official_text: '',
  verified: false,
  api_allowed: false,
}));
const output = new URL('../data-private/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('middle-science-review.json', output), JSON.stringify(candidates, null, 2) + '\n');
console.log(`${candidates.length} candidates prepared for official review (${commit})`);
