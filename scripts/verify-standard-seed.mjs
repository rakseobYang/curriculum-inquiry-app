import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { prepareTextbookSeed } from './prepare-textbook-seed.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const catalogPath = '../data-private/textbook-review/';
const pdfDirectory = process.argv[2];
if (pdfDirectory) {
  const fingerprints = JSON.parse((await read(catalogPath + 'pdf-fingerprints.json')).replace(/^\uFEFF/, ''));
  for (const { Name, SHA256 } of fingerprints) {
    const pdf = await readFile(join(pdfDirectory, Name));
    assert.equal(createHash('sha256').update(pdf).digest('hex').toUpperCase(), SHA256,
      'Reviewed PDF has changed: ' + Name);
  }
  console.log(`${fingerprints.length} reviewed PDFs match the recorded SHA-256 fingerprints.`);
}
const names = (await readdir(new URL(catalogPath, import.meta.url)))
  .filter(name => /^science[123]-.+-catalog\.json$/.test(name)).sort();
assert.ok(names.length > 0, 'No locally reviewed textbook catalogs');
const [migration, lookup, seed, comparison, candidates, textbooks] = await Promise.all([
  read('../supabase/migrations/202611220001_curriculum.sql'),
  read('../supabase/migrations/202611220002_evidence_lookup.sql'),
  read('../data-private/verified-standard-seed.sql'),
  read('../data-private/official-curriculum-comparison.json').then(JSON.parse),
  read('../data-private/middle-science-review.json').then(JSON.parse),
  Promise.all(names.map(name => read(catalogPath + name).then(JSON.parse))),
]);
const db = new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    grant usage on schema auth to authenticated;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await db.exec(migration);
  await db.exec(lookup);
  await db.exec(seed);
  await db.exec(seed);
  await db.exec('set role anon');
  await assert.rejects(db.query('select code from curriculum_standards'), { code: '42501' });
  await db.exec('reset role; set role authenticated');
  const { rows } = await db.query('select * from curriculum_standards');
  assert.equal(rows.length, 87);
  const candidateByCode = new Map(candidates.map(row => [row.code, row]));
  const officialByCode = new Map(comparison.comparisons.map(row => [row.code, row]));
  assert.deepEqual(new Set(rows.map(row => row.code)), new Set(officialByCode.keys()));
  for (const row of rows) {
    const reference = officialByCode.get(row.code);
    assert.equal(reference.status, 'whitespace-equivalent', row.code);
    assert.ok(reference.official_candidates.includes(row.official_text), row.code);
    assert.equal(row.dataset_commit, candidateByCode.get(row.code).dataset_commit, row.code);
    assert.match(row.official_source, /제2022-33호 별책 9/u);
    assert.equal(row.verified, true);
    assert.equal(row.api_allowed, false);
  }
  console.log('87 official statements loaded twice without duplicates; authenticated read passed; API disabled.');
  await db.exec('reset role');
  const textbookSeed = await read('../data-private/textbook-review-seed.sql');
  assert.equal(textbookSeed.replaceAll('\r\n', '\n'), prepareTextbookSeed(textbooks),
    'Textbook seed is out of date. Regenerate it from all reviewed catalogs before verification.');
  await db.exec(textbookSeed);
  await db.exec(textbookSeed);
  const totalSegments = textbooks.reduce((sum, book) => sum + book.segments.length, 0);
  const { rows: [linkCount] } = await db.query('select count(*)::int as total from textbook_standard_links');
  assert.equal(linkCount.total, totalSegments, 'Each reviewed segment must produce exactly one link.');
  for (const textbook of textbooks) {
    const { rows: links } = await db.query(
      `select e.lesson, e.lesson_end, e.total_unit_lessons, e.printed_page_start,
         e.printed_page_end, e.revision, e.lesson_basis, e.source_url, l.alignment_scope,
         l.supports_entire_standard, e.verified, e.display_allowed, e.api_allowed
       from textbook_standard_links l join textbook_evidence e on e.id = l.evidence_id
     where l.standard_code = $1 and e.volume = $2 and e.edition_id = $3 and e.unit_id = $4
     order by e.lesson, e.printed_page_start`,
      [textbook.standard_code, textbook.volume, textbook.edition_id, textbook.unit_id],
    );
    assert.deepEqual(links.map(Object.values), textbook.segments.map(segment =>
      [segment.lesson_start, segment.lesson_end, textbook.total_unit_lessons,
        ...segment.printed_pages, textbook.revision, textbook.lesson_basis,
        segment.source_url ? new URL(segment.source_url).href : null, segment.alignment_scope,
        segment.supports_entire_standard, true, false, false]), textbook.standard_code + ' ' + textbook.unit_id);
  }
  await db.exec("set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'");
  for (const textbook of textbooks) {
    const { rows: visible } = await db.query('select * from find_textbook_evidence($1)', [textbook.standard_code]);
    assert.deepEqual(visible, []);
  }
  console.log(`${totalSegments} textbook ranges linked locally; all hidden and API disabled.`);
  await db.exec('reset role');
  const { rows: coverage } = await db.query(`
    select s.code, s.official_text, count(e.id)::int as ranges,
      count(e.id) filter (where e.verified and e.display_allowed)::int as visible,
      count(e.id) filter (where s.api_allowed and e.verified and e.display_allowed and e.api_allowed)::int as usable
    from curriculum_standards s
    left join textbook_standard_links l on l.standard_code = s.code
    left join textbook_evidence e on e.id = l.evidence_id
    where s.verified
    group by s.code, s.official_text order by s.code
  `);
  const linked = coverage.filter(row => row.ranges > 0).length;
  const cell = value => String(value).replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
  const pageRange = ([start, end]) => start === end ? String(start) : `${start}–${end}`;
  const report = [
    '# 성취기준별 교과서 연결 현황',
    '',
    `2022년 별책 9 대조 기준 ${coverage.length}건 중 ${linked}건에 로컬 교과서 근거가 있다. ${coverage.length - linked}건은 등록된 연결이 없다.`,
    '연결 수는 검토한 구간 수이며, 성취기준의 모든 요구를 확인했다는 뜻은 아니다.',
    '',
    '| 성취기준 | 로컬 연결 구간 | 교사 표시 가능 | API 사용 가능 |',
    '|---|---:|---:|---:|',
    ...coverage.map(row => `| ${row.code} | ${row.ranges} | ${row.visible} | ${row.usable} |`),
    '',
    '## 검토 구간과 연결 범위',
    '',
    '| 성취기준 | 교과서 판본 | 단원 | 인쇄 쪽수 | PDF 페이지 | 차시 | 연결 범위 | 검토 내용 |',
    '|---|---|---|---|---|---|---|---|',
    ...textbooks.flatMap(book => book.segments.map(segment => {
      const lesson = book.lesson_basis === 'unassigned' ? '미확인'
        : `${pageRange([segment.lesson_start, segment.lesson_end])} (${book.lesson_basis === 'publisher' ? '출판사' : '교사 지정'})`;
      return '| ' + [book.standard_code, book.edition_id, book.unit_id, pageRange(segment.printed_pages),
        pageRange(segment.pdf_pages), lesson, segment.supports_entire_standard ? '전체' : '부분',
        segment.alignment_scope].map(cell).join(' | ') + ' |';
    })),
    '',
    '## 교과서 근거를 추가로 검토할 성취기준',
    '',
    '| 성취기준 | 교육부 고시 원문 |',
    '|---|---|',
    ...coverage.filter(row => row.ranges === 0).map(row => `| ${row.code} | ${cell(row.official_text)} |`),
    '',
  ].join('\n');
  await writeFile(new URL(catalogPath + 'standard-coverage.md', import.meta.url), report, 'utf8');
  console.log(`${linked}/${coverage.length} standards with local links; coverage report written.`);

  const [book] = textbooks;
  const firstUrl = 'https://example.invalid/verified-source';
  const updatedUrl = 'https://example.invalid/another-source';
  const withSource = url => prepareTextbookSeed([
    { ...book, segments: [{ ...book.segments[0], source_url: url }] },
  ]);
  await db.exec(withSource(firstUrl));
  const { rows: [updated] } = await db.query(
    'select id, display_allowed, api_allowed from textbook_evidence where source_url = $1', [firstUrl],
  );
  assert.equal(updated?.display_allowed, false);
  assert.equal(updated?.api_allowed, false);
  await db.query('update textbook_evidence set display_allowed = true where id = $1', [updated.id]);
  await db.exec(withSource(updatedUrl));
  const { rows: [approved] } = await db.query('select source_url from textbook_evidence where id = $1', [updated.id]);
  assert.equal(approved.source_url, firstUrl);
  console.log('Source URL updates work before display approval and preserve approved records.');
} finally {
  await db.close();
}
