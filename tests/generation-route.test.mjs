import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../app/api/lessons/generate/route.ts';
import { lessonSections } from '../lib/lesson-generation.ts';

const id = '12345678-1234-1234-1234-123456789abc';
const input = {
  evidenceId: id, standardCode: 'fixture', volume: 3, editionId: 'edition',
  unitId: 'unit', lesson: 3, totalLessons: 5, minutes: 45, equipment: [],
};
const draft = {
  ...Object.fromEntries(Object.keys(lessonSections).map(key => [key, '검증용 초안'])),
  phases: [{ activity: '검증용 활동', minutes: 45 }],
  recordingTable: { columns: ['시간 (분)', '온도 (°C)'], rowCount: 3 },
  evidenceIds: [id],
};
const row = {
  id, volume: 3, revision: '2015', edition_id: 'edition', unit_id: 'unit',
  lesson: 2, lesson_end: 3, total_unit_lessons: 5, lesson_basis: 'publisher',
  printed_page_start: 14, printed_page_end: 18, verified: true, api_allowed: true,
  approved_summary: '승인된 검증용 요약', textbook_standard_links: [{ standard_code: 'fixture' }],
  source_url: 'https://example.invalid/reference',
};

test('generation route authorizes and validates source selection before model dispatch', async t => {
  const settings = {
    SUPABASE_URL: 'https://db.example.invalid', SUPABASE_ANON_KEY: 'test-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'test-server-only', OPENAI_API_KEY: 'test-openai', OPENAI_MODEL: 'test-model',
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, settings);
  let authenticated = true;
  let evidence = row;
  let modelDraft = draft;
  let modelCalls = 0;
  let reserve = true;
  let payload;
  globalThis.fetch = async (url, options) => {
    const endpoint = new URL(url);
    switch (endpoint.pathname) {
      case '/auth/v1/user':
        return Response.json({ id }, { status: authenticated ? 200 : 401 });
      case '/rest/v1/rpc/reserve_lesson_generation':
        assert.equal(JSON.parse(options.body).requested_teacher, id);
        return Response.json(reserve);
      case '/rest/v1/curriculum_standards':
        return Response.json([{ code: 'fixture', curriculum: '2022', verified: true,
          official_source: '검증용 고시', official_text: '검증용 원문', api_allowed: true }]);
      case '/rest/v1/textbook_evidence':
        assert.equal(endpoint.searchParams.get('id'), 'eq.' + id);
        return Response.json([evidence]);
      case '/v1/chat/completions':
        modelCalls++;
        payload = JSON.parse(JSON.parse(options.body).messages[1].content);
        return Response.json({ choices: [{ message: {
          content: typeof modelDraft === 'string' ? modelDraft : JSON.stringify(modelDraft),
        } }] });
      default:
        throw Error('Unexpected request: ' + endpoint.pathname);
    }
  };
  const generate = (body = input) => POST(new Request('http://localhost/api/lessons/generate', {
    method: 'POST', headers: { authorization: 'Bearer test-session' }, body: JSON.stringify(body),
  }));
  authenticated = false;
  assert.equal((await generate()).status, 401);
  authenticated = true;
  assert.equal((await generate({ ...input, lesson: 4 })).status, 422);
  assert.equal((await generate({ ...input, totalLessons: 3 })).status, 422);
  evidence = { ...row, api_allowed: false };
  assert.equal((await generate()).status, 422);
  assert.equal(modelCalls, 0);
  evidence = row;
  reserve = false;
  assert.equal((await generate()).status, 429);
  assert.equal(modelCalls, 0);
  reserve = true;
  modelDraft = '{invalid JSON';
  const malformed = await generate();
  assert.equal(malformed.status, 502);
  assert.deepEqual(await malformed.json(), { status: 'model-output-invalid' });
  modelDraft = { ...draft, evidenceIds: ['fabricated'] };
  assert.equal((await generate()).status, 502);
  modelDraft = { ...draft, recordingTable: { columns: ['시간 (분)'], rowCount: 3 } };
  assert.equal((await generate()).status, 502);
  modelDraft = { ...draft, recordingTable: { ...draft.recordingTable, values: [[1, 30]] } };
  const result = await generate();
  assert.equal(result.status, 200);
  assert.deepEqual(payload.textbook, [{ id, summary: row.approved_summary }]);
  assert.deepEqual(payload.sourceLessonRange, [[2, 3]]);
  const data = await result.json();
  assert.deepEqual(data.draft.recordingTable, draft.recordingTable);
  assert.deepEqual(data.officialStandard, { code: 'fixture', official_text: '검증용 원문', official_source: '검증용 고시' });
  assert.deepEqual(data.designedLesson, { lesson: 3, total: 5 });
  assert.deepEqual(data.references[0].printedPages, [14, 18]);
  assert.equal(data.references[0].sourceUrl, row.source_url);
  evidence = { ...row, lesson: null, lesson_end: null, lesson_basis: 'unassigned', total_unit_lessons: null };
  const teacherSelected = await generate({ ...input, lesson: 4 });
  assert.equal(teacherSelected.status, 200);
  assert.deepEqual(payload.sourceLessonRange, [null]);
  const teacherDraft = await teacherSelected.json();
  assert.equal(teacherDraft.designedLesson.lesson, 4);
  assert.equal(teacherDraft.references[0].lesson, null);
});
