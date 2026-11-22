import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const quote = value => "'" + value.replaceAll("'", "''") + "'";
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const label = value => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= 200 && !value.includes('\0');

export function prepareTextbookSeed(catalogs) {
  const statements = ['begin;'];
  for (const catalog of catalogs) {
    const { volume, revision, edition_id, unit_id, standard_code, total_unit_lessons, lesson_basis, segments } = catalog;
    if (![1, 2, 3].includes(volume) || revision !== (volume === 3 ? '2015' : '2022') ||
        !label(edition_id) || !label(unit_id) || !/^\[9과\d{2}-\d{2}\]$/u.test(standard_code) ||
        (total_unit_lessons != null && !positive(total_unit_lessons)) ||
        !['publisher', 'teacher', 'unassigned'].includes(lesson_basis) || !Array.isArray(segments) || !segments.length ||
        catalog.display_allowed !== false || catalog.api_allowed !== false) {
      throw Error('Invalid or already approved review catalog');
    }
    for (const segment of segments) {
      const { lesson_start: start, lesson_end: end, printed_pages: pages,
        pdf_pages: pdfPages, alignment_scope: scope, supports_entire_standard: entire,
        source_url: sourceUrl } = segment;
      const source = typeof sourceUrl === 'string' ? URL.parse(sourceUrl) : null;
      if (sourceUrl != null && (!source || source.protocol !== 'https:' || source.username || source.password)) {
        throw Error('Invalid public source URL');
      }
      const validRange = lesson_basis === 'unassigned'
        ? start === null && end === null
        : positive(start) && positive(end) && start <= end;
      if (!validRange ||
          (total_unit_lessons != null && end > total_unit_lessons) ||
          !Array.isArray(pages) || pages.length !== 2 || !pages.every(positive) || pages[0] > pages[1] ||
          !Array.isArray(pdfPages) || pdfPages.length !== 2 || !pdfPages.every(positive) ||
          pdfPages[1] - pdfPages[0] !== pages[1] - pages[0] ||
          !label(scope) || typeof entire !== 'boolean') throw Error('Invalid review segment');
      const identity = JSON.stringify([volume, revision, edition_id, unit_id, start, end, total_unit_lessons ?? null, lesson_basis, pages]);
      const hex = createHash('sha256').update(identity).digest('hex').slice(0, 32);
      const id = hex.replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
      statements.push(
        'insert into public.textbook_evidence (id,volume,revision,edition_id,unit_id,lesson,lesson_end,total_unit_lessons,lesson_basis,printed_page_start,printed_page_end,source_url,verified,display_allowed,api_allowed)',
        `values (${quote(id)},${volume},${quote(revision)},${quote(edition_id)},${quote(unit_id)},${start},${end},${total_unit_lessons ?? 'null'},${quote(lesson_basis)},${pages.join(',')},${source ? quote(source.href) : 'null'},true,false,false) on conflict (id) ${source ? 'do update set source_url = excluded.source_url where not textbook_evidence.display_allowed and not textbook_evidence.api_allowed' : 'do nothing'};`,
        'insert into public.textbook_standard_links (evidence_id,standard_code,alignment_scope,supports_entire_standard)',
        `values (${quote(id)},${quote(standard_code)},${quote(scope)},${entire}) on conflict (evidence_id,standard_code) do nothing;`,
      );
    }
  }
  return [...statements, 'commit;', ''].join('\n');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const paths = process.argv.slice(2);
  if (!paths.length) throw Error('Provide one or more locally verified catalog JSON files');
  const catalogs = await Promise.all(paths.map(path => readFile(path, 'utf8').then(JSON.parse)));
  await writeFile(new URL('../data-private/textbook-review-seed.sql', import.meta.url),
    prepareTextbookSeed(catalogs), 'utf8');
  console.log('Wrote local review SQL with display and API transfer disabled.');
}
