import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const seed = await readFile(new URL('../data-private/verified-standard-seed.sql', import.meta.url), 'utf8');
const db = new PGlite();
try {
  await db.exec(`create table public_curriculum_standards (
    code text primary key, curriculum text not null, official_source text not null,
    official_text text not null, dataset_commit text not null, verified boolean not null,
    api_allowed boolean not null
  )`);
  await db.exec(seed.replaceAll('public.curriculum_standards', 'public_curriculum_standards'));
  const { rows } = await db.query(`select code, curriculum, official_source, official_text,
    dataset_commit, verified from public_curriculum_standards order by code`);
  if (rows.length !== 87 || rows.some(row => row.curriculum !== '2022' || !row.verified ||
      !row.official_source.trim() || !row.official_text.trim() || !/^[a-f0-9]{40}$/.test(row.dataset_commit))) {
    throw new Error('Public curriculum export failed verification');
  }
  const output = new URL('../data/standards.json', import.meta.url);
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  const contents = JSON.stringify(rows, null, 2) + '\n';
  await writeFile(output, contents, 'utf8');
  await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
  await writeFile(new URL('../public/data/standards.json', import.meta.url), contents, 'utf8');
  console.log(`Exported ${rows.length} verified 2022 science standards; textbook evidence and API permissions excluded.`);
} finally {
  await db.close();
}
