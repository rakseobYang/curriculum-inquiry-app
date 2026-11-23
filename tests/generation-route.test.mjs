import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../workers/src/handler.ts';
import { lessonSections } from '../lib/lesson-schema.ts';
import { reserveUsage } from '../workers/src/usage-limiter.ts';

const code = '[9과01-01]';
const allowedOrigin = 'https://school.example.invalid';
const outputDraft = {
  ...Object.fromEntries(Object.keys(lessonSections).map(key => [key, '검증용 초안'])),
  phases: [{ activity: '학생이 관찰 자료를 기록합니다.', minutes: 15 },
    { activity: '관찰 근거로 설명하고 새 상황에 적용합니다.', minutes: 30 }],
  recordingTable: { columns: ['조건', '관찰 결과'], rowCount: 3 },
};

function makeEnv() {
  let now = 1_800_000_000_000;
  const states = new Map();
  return {
    env: {
      AI: { async run() { throw new Error('Unexpected inference call'); } },
      TURNSTILE_SECRET_KEY: 'fixture-only-secret',
      RATE_LIMIT_HMAC_KEY: 'fixture-hmac-key',
      ALLOWED_ORIGIN: allowedOrigin,
      GENERATION_LIMITER: {
        idFromName: name => name,
        get: id => {
          if (!states.has(id)) states.set(id, new Map());
          const storageState = states.get(id);
          const storage = {
            async get(key) { return storageState.get(key); },
            async put(key, value) { storageState.set(key, value); },
            async setAlarm(value) { storageState.set('alarm', value); },
            async deleteAll() { storageState.clear(); },
          };
          return { fetch: request => reserveUsage(storage, request, now) };
        },
      },
    },
    setNow(value) { now = value; },
  };
}

function makeRequest(body, { origin = allowedOrigin, contentType = 'application/json', method = 'POST' } = {}) {
  return new Request('https://worker.example.invalid/generate', {
    method,
    headers: { origin, 'content-type': contentType, 'cf-connecting-ip': '192.0.2.44' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

function generationBody(overrides = {}) {
  return {
    standardCode: code,
    lesson: 1,
    totalLessons: 3,
    minutes: 45,
    equipment: ['온도계'],
    studentConditions: '4명씩 모둠',
    turnstileToken: 'one-use-fixture-token',
    ...overrides,
  };
}

test('Workers generation verifies origin, Turnstile, usage quota, source, and actual-shaped output', async t => {
  const originalFetch = globalThis.fetch;
  let aiCalls = 0;
  let turnstileCalls = 0;
  let aiPayload;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === 'challenges.cloudflare.com') {
      turnstileCalls++;
      assert.match(String(init.body), /fixture-only-secret/);
      return Response.json({ success: true, hostname: 'school.example.invalid', action: 'generate' });
    }
    throw new Error('Unexpected external fetch');
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { env } = makeEnv();
  env.AI.run = async (model, input) => {
    assert.equal(model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    aiCalls++;
    aiPayload = input;
    return { response: outputDraft };
  };
  const response = await worker.fetch(makeRequest(generationBody()), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
  const result = await response.json();
  assert.equal(result.generationMode, 'official-curriculum-only');
  assert.equal(result.alignmentStatus, 'teacher-review');
  assert.deepEqual(result.officialStandard, {
    code,
    official_text: result.officialStandard.official_text,
    official_source: result.officialStandard.official_source,
  });
  assert.ok(result.officialStandard.official_text.length > 0);
  assert.deepEqual(result.references, []);
  assert.equal(result.draft.phases.reduce((sum, phase) => sum + phase.minutes, 0), 45);
  assert.equal(aiCalls, 1);
  assert.equal(turnstileCalls, 1);
  assert.equal(aiPayload.max_tokens, 1800);
  assert.equal(aiPayload.response_format.type, 'json_schema');
  assert.match(aiPayload.messages[1].content, /"textbookEvidence":null/u);
  assert.ok(!JSON.stringify(aiPayload).includes('approvedSummary'));
  assert.ok(!JSON.stringify(aiPayload).includes('printed_page'));
});

test('Workers blocks missing configuration, bad origin, failed Turnstile, invalid requests, and oversize bodies before inference', async t => {
  const originalFetch = globalThis.fetch;
  let aiCalls = 0;
  let turnstileSuccess = false;
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'challenges.cloudflare.com') {
      return Response.json({ success: turnstileSuccess, hostname: 'school.example.invalid', action: 'generate' });
    }
    throw new Error('Unexpected external fetch');
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { env } = makeEnv();
  env.AI.run = async () => { aiCalls++; };
  const noConfig = await worker.fetch(makeRequest(generationBody()), { ...env, AI: undefined });
  assert.equal(noConfig.status, 503);
  const wrongOrigin = await worker.fetch(makeRequest(generationBody(), { origin: 'https://attacker.example' }), env);
  assert.equal(wrongOrigin.status, 403);
  const invalidStandard = await worker.fetch(makeRequest(generationBody({ standardCode: '[9과99-99]' })), env);
  assert.equal(invalidStandard.status, 422);
  const failedChallenge = await worker.fetch(makeRequest(generationBody()), env);
  assert.equal(failedChallenge.status, 403);
  turnstileSuccess = true;
  const wrongMinutes = await worker.fetch(makeRequest(generationBody({ minutes: 0 })), env);
  assert.equal(wrongMinutes.status, 400);
  const tooLarge = new Request('https://worker.example.invalid/generate', {
    method: 'POST', headers: { origin: allowedOrigin, 'content-type': 'application/json', 'content-length': '12000' },
    body: '{}',
  });
  assert.equal((await worker.fetch(tooLarge, env)).status, 413);
  assert.equal(aiCalls, 0);
});

test('Durable usage limiter persists daily counts, enforces cooldown, and resets on the next day', async () => {
  const data = new Map();
  const storage = {
    async get(key) { return data.get(key); },
    async put(key, value) { data.set(key, value); },
    async setAlarm(value) { data.set('alarm', value); },
    async deleteAll() { data.clear(); },
  };
  const reservation = day => new Request('https://rate.internal/reserve', { method: 'POST',
    body: JSON.stringify({ day, limit: 2, intervalMs: 1000 }) });
  assert.equal((await reserveUsage(storage, reservation('2026-11-22'), 10000)).status, 200);
  assert.equal((await reserveUsage(storage, reservation('2026-11-22'), 10500)).status, 429);
  assert.equal((await reserveUsage(storage, reservation('2026-11-22'), 11000)).status, 200);
  assert.equal((await reserveUsage(storage, reservation('2026-11-22'), 12000)).status, 429);
  assert.equal((await reserveUsage(storage, reservation('2026-11-23'), 12001)).status, 200);
  assert.ok(data.get('alarm') > 12001);
});
