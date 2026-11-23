import standards from '../../data/standards.json' with { type: 'json' };
import { lessonPrompt, validateLessonDraft, type OfficialStandard } from '../../lib/lesson-schema.ts';

const MAX_BODY_BYTES = 10 * 1024;
const MAX_OUTPUT_TOKENS = 1800;
const AI_TIMEOUT_MS = 25_000;
const DAILY_REQUEST_LIMIT = 20;
const GLOBAL_DAILY_REQUEST_LIMIT = 100;
const MIN_REQUEST_INTERVAL_MS = 5_000;
const MAX_EQUIPMENT = 12;
const standardsByCode = new Map((standards as OfficialStandard[]).map(row => [row.code, row]));

type WorkerEnv = {
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  TURNSTILE_SECRET_KEY?: string;
  RATE_LIMIT_HMAC_KEY?: string;
  ALLOWED_ORIGIN?: string;
  GENERATION_LIMITER: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
};

type LessonRequest = {
  standardCode: string;
  lesson: number;
  totalLessons: number;
  minutes: number;
  equipment: string[];
  studentConditions: string;
  turnstileToken: string;
};

function json(status: number, payload: Record<string, unknown>, origin?: string) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
    headers.set('access-control-allow-methods', 'POST, OPTIONS');
    headers.set('access-control-allow-headers', 'Content-Type');
    headers.set('access-control-max-age', '600');
  }
  return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers });
}

async function readJsonLimited(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) throw new Error('too-large');
  if (!request.body) throw new Error('invalid-json');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('too-large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)); }
  catch { throw new Error('invalid-json'); }
}

function parseInput(value: unknown): LessonRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => ![
    'standardCode', 'lesson', 'totalLessons', 'minutes', 'equipment', 'studentConditions', 'turnstileToken',
  ].includes(key))) return;
  if (typeof input.standardCode !== 'string' || !/^\[9과\d{2}-\d{2}\]$/.test(input.standardCode) ||
      !Number.isSafeInteger(input.lesson) || !Number.isSafeInteger(input.totalLessons) ||
      (input.lesson as number) < 1 || (input.totalLessons as number) < (input.lesson as number) ||
      (input.totalLessons as number) > 50 || !Number.isSafeInteger(input.minutes) ||
      (input.minutes as number) < 1 || (input.minutes as number) > 300 ||
      !Array.isArray(input.equipment) || input.equipment.length > MAX_EQUIPMENT ||
      !input.equipment.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 100) ||
      typeof input.studentConditions !== 'string' || input.studentConditions.length > 400 ||
      typeof input.turnstileToken !== 'string' || input.turnstileToken.length < 1 || input.turnstileToken.length > 2048) return;
  return input as LessonRequest;
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function privateIpId(ip: string, key: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(ip))));
}

async function verifyTurnstile(token: string, ip: string, secret: string, hostname: string) {
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: ip, idempotency_key: crypto.randomUUID() }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return false;
  const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
  return result.success === true && result.hostname === hostname && result.action === 'generate';
}

const lessonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    objective: { type: 'string' }, concepts: { type: 'string' }, investigationQuestion: { type: 'string' },
    investigation: { type: 'string' }, record: { type: 'string' }, explanation: { type: 'string' },
    application: { type: 'string' }, assessment: { type: 'string' }, materialsAndSafety: { type: 'string' },
    alignment: { type: 'string' },
    phases: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { activity: { type: 'string' }, minutes: { type: 'integer' } }, required: ['activity', 'minutes'] } },
    recordingTable: { type: 'object', additionalProperties: false,
      properties: { columns: { type: 'array', items: { type: 'string' } }, rowCount: { type: 'integer' } },
      required: ['columns', 'rowCount'] },
  },
  required: ['objective', 'concepts', 'investigationQuestion', 'investigation', 'record', 'explanation',
    'application', 'assessment', 'materialsAndSafety', 'alignment', 'phases', 'recordingTable'],
};

async function generate(input: LessonRequest, standard: OfficialStandard, ai: NonNullable<WorkerEnv['AI']>) {
  const { instructions, content } = lessonPrompt(standard, input);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let payload: unknown;
  try {
    payload = await Promise.race([
      ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [{ role: 'system', content: instructions }, { role: 'user', content }],
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_schema', json_schema: lessonSchema },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('model-unavailable')), AI_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  let value = payload && typeof payload === 'object' ? (payload as { response?: unknown }).response : undefined;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('model-output-invalid'); }
  }
  const draft = validateLessonDraft(value, input.minutes);
  if (!draft) throw new Error('model-output-invalid');
  return {
    status: 'generated',
    generationMode: 'official-curriculum-only',
    alignmentStatus: 'teacher-review',
    officialStandard: { code: standard.code, official_text: standard.official_text,
      official_source: standard.official_source },
    designedLesson: { lesson: input.lesson, total: input.totalLessons },
    plannedMinutes: input.minutes,
    plannedEquipment: input.equipment,
    plannedClassConditions: input.studentConditions,
    draft,
    references: [],
  };
}

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const origin = request.headers.get('origin') ?? '';
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return json(403, { status: 'origin-not-allowed' });
    if (request.method === 'OPTIONS') return json(204, {}, origin);
    if (request.method !== 'POST') return json(405, { status: 'method-not-allowed' }, origin);
    if (!env.AI || !env.TURNSTILE_SECRET_KEY || !env.RATE_LIMIT_HMAC_KEY ||
        !env.GENERATION_LIMITER) return json(503, { status: 'service-unconfigured' }, origin);
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return json(415, { status: 'invalid-input' }, origin);
    }
    let value: unknown;
    try { value = await readJsonLimited(request); }
    catch (error) {
      return json(error instanceof Error && error.message === 'too-large' ? 413 : 400,
        { status: error instanceof Error && error.message === 'too-large' ? 'input-too-large' : 'invalid-input' }, origin);
    }
    const input = parseInput(value);
    if (!input) return json(400, { status: 'invalid-input' }, origin);
    const standard = standardsByCode.get(input.standardCode);
    if (!standard?.verified || standard.curriculum !== '2022' || !standard.official_text || !standard.official_source) {
      return json(422, { status: 'standard-unverified' }, origin);
    }
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip) return json(503, { status: 'rate-limit-unavailable' }, origin);
    let turnstileValid = false;
    try {
      turnstileValid = await verifyTurnstile(input.turnstileToken, ip, env.TURNSTILE_SECRET_KEY,
        new URL(env.ALLOWED_ORIGIN).hostname);
    } catch { return json(503, { status: 'verification-unavailable' }, origin); }
    if (!turnstileValid) return json(403, { status: 'verification-failed' }, origin);
    try {
      const id = await privateIpId(ip, env.RATE_LIMIT_HMAC_KEY);
      const limiter = env.GENERATION_LIMITER.get(env.GENERATION_LIMITER.idFromName(id));
      const reservation = await limiter.fetch(new Request('https://rate-limit.internal/reserve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day: new Date().toISOString().slice(0, 10), limit: DAILY_REQUEST_LIMIT,
          intervalMs: MIN_REQUEST_INTERVAL_MS }),
      }));
      if (reservation.status === 429) return json(429, { status: 'generation-limit' }, origin);
      if (!reservation.ok) return json(503, { status: 'rate-limit-unavailable' }, origin);
      const globalLimiter = env.GENERATION_LIMITER.get(env.GENERATION_LIMITER.idFromName('global-daily'));
      const globalReservation = await globalLimiter.fetch(new Request('https://rate-limit.internal/reserve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day: new Date().toISOString().slice(0, 10),
          limit: GLOBAL_DAILY_REQUEST_LIMIT, intervalMs: 0 }),
      }));
      if (globalReservation.status === 429) return json(429, { status: 'generation-limit' }, origin);
      if (!globalReservation.ok) return json(503, { status: 'rate-limit-unavailable' }, origin);
    } catch { return json(503, { status: 'rate-limit-unavailable' }, origin); }
    try { return json(200, await generate(input, standard, env.AI), origin); }
    catch (error) {
      return json(502, { status: error instanceof Error && error.message === 'model-output-invalid'
        ? 'model-output-invalid' : 'model-unavailable' }, origin);
    }
  },
};

export default worker;
