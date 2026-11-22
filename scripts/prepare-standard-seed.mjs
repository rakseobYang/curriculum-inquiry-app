import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL('../data-private/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, directory), 'utf8'));
const [candidates, report] = await Promise.all([
  read('middle-science-review.json'), read('official-curriculum-comparison.json'),
]);
const checks = new Map(report.comparisons.map(row => [row.code, row]));
const normalize = text => text.replace(/\s+/gu, '');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
if (candidates.length !== 87 || checks.size !== candidates.length || report.codes_only_in_annex.length) {
  throw new Error('The upstream and official Annex 9 code sets must match before preparing a seed');
}
const source = '교육부 고시 제2022-33호 별책 9 과학과 교육과정 (2022.12.22.) https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=141&boardSeq=93458&lev=0&statusYN=W';
const seen = new Set();
const rows = candidates.map(candidate => {
  const check = checks.get(candidate.code);
  const matches = check?.official_candidates.filter(text =>
    normalize(text) === normalize(candidate.candidate_text));
  if (seen.has(candidate.code) || check?.status !== 'whitespace-equivalent' || !matches?.length ||
      !/^[a-f0-9]{40}$/.test(candidate.dataset_commit)) {
    throw new Error('Unverified or duplicate candidate: ' + candidate.code);
  }
  seen.add(candidate.code);
  return '(' + [candidate.code, '2022', source, matches[0], candidate.dataset_commit]
    .map(quote).join(', ') + ', true, false)';
});
const sql = [
  '-- Verified against the 2022 Annex 9 source. External API use remains disabled.',
  'insert into public.curriculum_standards',
  '  (code, curriculum, official_source, official_text, dataset_commit, verified, api_allowed)',
  'values',
  rows.join(',\n'),
  'on conflict (code) do nothing;',
].join('\n') + '\n';
await writeFile(new URL('verified-standard-seed.sql', directory), sql);
console.log(`Prepared ${rows.length} verified standards for local review. No database writes performed.`);
