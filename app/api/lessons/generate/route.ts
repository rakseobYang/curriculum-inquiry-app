import { generateLesson } from '../../../../lib/lesson-generation.ts';
import type { LessonInput, Standard, TextbookEvidence } from '../../../../lib/evidence.ts';

// Auth, parallel catalog reads, quota reservation and model timeouts total 54 seconds.
export const maxDuration = 60;

function parseInput(value: unknown): LessonInput | undefined {
  if (!value || typeof value !== 'object') return;
  const input = value as Partial<LessonInput>;
  const shortText = (v: unknown): v is string =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
  if (typeof input.evidenceId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.evidenceId) ||
      !shortText(input.standardCode) || !shortText(input.editionId) || !shortText(input.unitId) ||
      (input.volume !== 1 && input.volume !== 2 && input.volume !== 3) ||
      typeof input.lesson !== 'number' || typeof input.totalLessons !== 'number' ||
      typeof input.minutes !== 'number' || !Number.isSafeInteger(input.lesson) ||
      !Number.isSafeInteger(input.totalLessons) || input.lesson < 1 || input.lesson > input.totalLessons ||
      !Number.isSafeInteger(input.minutes) || input.minutes < 1 || input.minutes > 600 ||
      !Array.isArray(input.equipment) || input.equipment.length > 30 ||
      !input.equipment.every(shortText) ||
      (input.studentConditions !== undefined &&
        (typeof input.studentConditions !== 'string' || input.studentConditions.length > 400))) return;
  return input as LessonInput;
}

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return Response.json({ status: 'unauthorized' }, { status: 401 });
  const input = parseInput(await request.json().catch(() => null));
  if (!input) return Response.json({ status: 'invalid-input' }, { status: 400 });
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service,
    OPENAI_API_KEY: key, OPENAI_MODEL: model } = process.env;
  if (!url || !anon || !service || !key || !model) {
    return Response.json({ status: 'service-unconfigured' }, { status: 503 });
  }
  try {
    const auth = await fetch(new URL('/auth/v1/user', url), {
      headers: { apikey: anon, authorization }, signal: AbortSignal.timeout(8000),
    });
    if (auth.status === 401 || auth.status === 403) {
      return Response.json({ status: 'unauthorized' }, { status: 401 });
    }
    if (!auth.ok) throw new Error('Auth unavailable');
    const { id: teacherId } = await auth.json();
    if (typeof teacherId !== 'string') throw new Error('Missing authenticated teacher');
    const dailyLimit = Number(process.env.LESSON_GENERATION_DAILY_LIMIT ?? 10);
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) {
      return Response.json({ status: 'service-unconfigured' }, { status: 503 });
    }
    const read = async (table: string, filters: Record<string, string>) => {
      const endpoint = new URL('/rest/v1/' + table, url);
      endpoint.search = new URLSearchParams(filters).toString();
      const result = await fetch(endpoint, {
        headers: { apikey: service, authorization: 'Bearer ' + service },
        cache: 'no-store', signal: AbortSignal.timeout(8000),
      });
      if (!result.ok) throw new Error('Catalog unavailable');
      return result.json();
    };
    const [standards, rows] = await Promise.all([
      read('curriculum_standards', { code: 'eq.' + input.standardCode }),
      read('textbook_evidence', {
        select: '*,textbook_standard_links(standard_code,alignment_scope,supports_entire_standard)',
        id: 'eq.' + input.evidenceId,
        volume: 'eq.' + input.volume, edition_id: 'eq.' + input.editionId,
        unit_id: 'eq.' + input.unitId,
        verified: 'eq.true', display_allowed: 'eq.true',
      }),
    ]);
    const row = standards[0];
    const standard: Standard | undefined = row && {
      code: row.code, curriculum: row.curriculum, officialSource: row.official_source,
      officialText: row.official_text, verified: row.verified, apiAllowed: row.api_allowed,
    };
    type CatalogRow = {
      id: string; volume: TextbookEvidence['volume']; revision: TextbookEvidence['revision'];
      edition_id: string; unit_id: string; lesson: number | null; lesson_basis: TextbookEvidence['lessonBasis'];
      lesson_end: number | null;
      total_unit_lessons: number | null;
      printed_page_start: number; printed_page_end: number; verified: boolean;
      api_allowed: boolean; approved_summary: string;
      textbook_standard_links: {
        standard_code: string; alignment_scope: string | null; supports_entire_standard: boolean | null;
      }[];
      source_url: string | null;
    };
    const catalog: TextbookEvidence[] = rows.map((r: CatalogRow) => ({
      id: r.id, volume: r.volume, revision: r.revision, editionId: r.edition_id, unitId: r.unit_id,
      lesson: r.lesson, lessonBasis: r.lesson_basis, printedPages: [r.printed_page_start, r.printed_page_end],
      lessonEnd: r.lesson_end ?? undefined,
      totalUnitLessons: r.total_unit_lessons ?? undefined,
      standardCodes: r.textbook_standard_links.map(link => link.standard_code),
      verified: r.verified, apiAllowed: r.api_allowed, approvedSummary: r.approved_summary,
      sourceUrl: r.source_url && /^https?:\/\//i.test(r.source_url) ? r.source_url : undefined,
      alignmentScope: r.textbook_standard_links.find(link => link.standard_code === input.standardCode)?.alignment_scope ?? undefined,
      supportsEntireStandard: r.textbook_standard_links.find(link => link.standard_code === input.standardCode)?.supports_entire_standard ?? undefined,
    }));
    let quotaStatus: 'limited' | 'unavailable' | undefined;
    const result = await generateLesson(input, standard, catalog, async (system, content) => {
      quotaStatus = 'unavailable';
      const reservation = await fetch(new URL('/rest/v1/rpc/reserve_lesson_generation', url), {
        method: 'POST',
        headers: { apikey: service, authorization: 'Bearer ' + service, 'content-type': 'application/json' },
        body: JSON.stringify({ requested_teacher: teacherId, daily_limit: dailyLimit }),
        signal: AbortSignal.timeout(8000),
      });
      if (!reservation.ok) throw new Error('Quota unavailable');
      const reserved = await reservation.json();
      if (reserved === false) quotaStatus = 'limited';
      if (reserved !== true) throw new Error('Quota not reserved');
      quotaStatus = undefined;
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({ model, store: false, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error('Generation failed');
      const body = await response.json().catch(() => null);
      const contentText = body?.choices?.[0]?.message?.content;
      if (typeof contentText !== 'string') return null;
      try {
        return JSON.parse(contentText);
      } catch {
        return null;
      }
    });
    if (quotaStatus === 'limited') return Response.json({ status: 'generation-limit' }, { status: 429 });
    if (quotaStatus === 'unavailable') return Response.json({ status: 'service-unconfigured' }, { status: 503 });
    const status = result.status === 'generated' ? 200 : result.status.startsWith('model-') ? 502 : 422;
    return Response.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'catalog-unavailable' }, { status: 503 });
  }
}
