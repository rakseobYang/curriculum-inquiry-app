'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { lessonSections } from '../lib/lesson-generation.ts';
import type { generateLesson } from '../lib/lesson-generation.ts';

type Standard = { code: string; official_text: string; official_source: string };
type Generated = Extract<Awaited<ReturnType<typeof generateLesson>>, { status: 'generated' }>;
type Key = keyof typeof lessonSections;
const alignmentChecks = {
  content: '학습 목표와 핵심 개념이 성취기준의 내용에 맞습니다.',
  performance: '학생이 성취기준에서 요구하는 수행을 직접 합니다.',
  evidence: '학생이 관찰하거나 수집한 자료를 근거로 설명합니다.',
  assessment: '평가가 성취기준의 수행과 새 실생활 문제 적용을 확인합니다.',
} as const;
type AlignmentCheck = keyof typeof alignmentChecks;
const alignmentKeys = Object.keys(alignmentChecks) as AlignmentCheck[];
type EditorState = {
  result: Generated; standard: Standard; title: string;
  verifiedChecks?: Partial<Record<AlignmentCheck, boolean>>;
  alignmentNotes?: string;
};
type SavedPlan = { id: string; title: string };
type Source = {
  id: string; volume: number; revision: string; edition_id: string; unit_id: string;
  lesson: number | null; lesson_end: number | null; lesson_basis: string; printed_page_start: number; printed_page_end: number;
  total_unit_lessons?: number | null;
  source_url: string | null; generation_available: boolean;
  alignment_scope?: string | null; supports_entire_standard?: boolean | null;
};
function scopeLabel(scope?: string | null, entire?: boolean | null) {
  const label = entire === false ? '성취기준 부분 근거' : '자료 범위';
  return scope ? label + ' · ' + scope : entire === false ? label : '자료 범위 정보 미등록';
}
function lessonLabel(start: number | null, end?: number | null) {
  if (start === null) return '출판사 차시 미확인';
  end ??= start;
  return (start === end ? start : start + '–' + end) + '차시';
}
function normalizeStandardSearch(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\[\]]/gu, '').replace(/[–—−]/gu, '-');
}
function officialSourceUrl(source: string) {
  const url = source.match(/https:\/\/[^\s]+$/u)?.[0];
  return url && URL.canParse(url) ? url : undefined;
}
const messages: Record<string, string> = {
  'invalid-input': '입력한 차시와 수업 조건을 확인해 주세요.',
  'standard-unverified': '공식 고시와 대조한 성취기준이 없습니다.',
  'textbook-unverified': '선택한 판본·단원·차시에 검증된 교과서 근거가 없습니다.',
  'transfer-not-approved': '이 범위에 생성에 사용할 수 있는 전송 승인 자료가 없습니다.',
  'unauthorized': '다시 로그인해 주세요.',
  'service-unconfigured': '서버 연결 설정을 확인해 주세요.',
  'generation-limit': '오늘의 수업안 생성 한도에 도달했습니다. 한국 시간 자정 이후 다시 시도해 주세요.',
  'catalog-unavailable': '서버에서 교과서 근거를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  'model-unavailable': 'AI 생성 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  'model-output-invalid': '초안의 시간 배분 또는 근거를 검증하지 못했습니다. 수업안 생성을 다시 시도해 주세요.',
};

export default function LessonEditor({ url, anon }: { url: string; anon: string }) {
  const [token, setToken] = useState('');
  const [editorOwner, setEditorOwner] = useState('');
  const [standards, setStandards] = useState<Standard[]>([]);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState>();
  const [savedEditor, setSavedEditor] = useState<EditorState>();
  const [savedId, setSavedId] = useState('');
  const pendingPlanId = useRef('');
  const [saved, setSaved] = useState<SavedPlan[]>([]);
  const [savedQuery, setSavedQuery] = useState('');
  const [savedListFailed, setSavedListFailed] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [volumeFilter, setVolumeFilter] = useState(0);
  const [sourceId, setSourceId] = useState('');
  const [sourceStatus, setSourceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const standard = standards.find(row => row.code === selected);
  const result = editor?.result;
  const verifiedCount = alignmentKeys.filter(key => editor?.verifiedChecks?.[key] === true).length;
  const phaseMinutes = result?.draft.phases.reduce((total, phase) => total + phase.minutes, 0) ?? 0;
  const plannedMinutes = result?.plannedMinutes ?? phaseMinutes;
  const validTiming = phaseMinutes === plannedMinutes && Boolean(result?.draft.phases.every(phase =>
    phase.activity.trim() && Number.isSafeInteger(phase.minutes) && phase.minutes > 0));
  const columnTitles = result?.draft.recordingTable?.columns.map(title => title.trim()) ?? [];
  const validColumnTitles = columnTitles.every(Boolean) && new Set(columnTitles).size === columnTitles.length;
  const source = sources.find(row => row.id === sourceId);
  const matchingSources = sources.filter(row => volumeFilter === 0 || row.volume === volumeFilter);
  const hasUnsavedPlan = Boolean(editor && editor !== savedEditor);

  useEffect(() => {
    if (!hasUnsavedPlan) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [hasUnsavedPlan]);

  function confirmDiscard() {
    return !hasUnsavedPlan || window.confirm('저장하지 않은 수업안이 있습니다. 현재 수업안을 닫을까요?');
  }

  function editPhases(phases: Generated['draft']['phases']) {
    if (!editor || !result) return;
    setEditor({ ...editor, verifiedChecks: {},
      result: { ...result, plannedMinutes, draft: { ...result.draft, phases } } });
  }

  useEffect(() => {
    if (!token || !selected) return;
    const controller = new AbortController();
    setSourceStatus('loading');
    fetch(new URL('/rest/v1/rpc/find_textbook_evidence', url), {
      method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: 'no-store',
      headers: { apikey: anon, authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ requested_standard: selected }),
    }).then(async response => {
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        setSources([]);
        setSourceId('');
        setSourceStatus('idle');
        setToken('');
        setError('로그인 시간이 만료됐습니다. 다시 로그인해 주세요.');
        return;
      }
      if (!response.ok) throw Error();
      const rows: Source[] = await response.json();
      if (controller.signal.aborted) return;
      setSources(rows);
      setSourceStatus('ready');
    }).catch(() => {
      if (!controller.signal.aborted) setSourceStatus('error');
    });
    return () => controller.abort();
  }, [url, anon, token, selected, lookupAttempt]);

  async function planRequest(sessionToken: string, filters: Record<string, string>, method = 'GET', body?: unknown) {
    const endpoint = new URL('/rest/v1/lesson_plans', url);
    endpoint.search = new URLSearchParams(filters).toString();
    const response = await fetch(endpoint, {
      method,
      headers: { apikey: anon, authorization: 'Bearer ' + sessionToken,
        'content-type': 'application/json',
        prefer: method === 'POST' ? 'return=representation,resolution=merge-duplicates' : 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 401) setToken('');
    if (!response.ok) throw Error();
    return response.json();
  }

  async function savePlan() {
    if (!editor || !editor.title.trim() || !validTiming || !validColumnTitles) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const id = savedId || (pendingPlanId.current ||= crypto.randomUUID());
      const rows = await planRequest(token, {
        select: 'id,title', ...(savedId ? { id: 'eq.' + savedId } : {}),
      }, savedId ? 'PATCH' : 'POST', {
        ...(savedId ? {} : { id }), title: editor.title.trim(), standard_code: editor.standard.code, editor_state: editor,
      });
      const plan: SavedPlan | undefined = rows[0];
      if (!plan) throw Error();
      setSavedId(plan.id);
      pendingPlanId.current = '';
      setSavedEditor(editor);
      setSaved(previous => [plan, ...previous.filter(row => row.id !== plan.id)]);
      setFeedback('수업안을 저장했습니다.');
    } catch {
      setError('저장하지 못했습니다. 편집 내용은 화면에 남아 있습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function loadSavedPlans(sessionToken: string) {
    try {
      setSaved(await planRequest(sessionToken, { select: 'id,title', order: 'created_at.desc' }));
      setSavedListFailed(false);
    } catch {
      setSavedListFailed(true);
    }
  }

  async function openPlan(id: string) {
    if (!confirmDiscard()) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const rows = await planRequest(token, { select: 'id,title,editor_state', id: 'eq.' + id });
      const row = rows[0];
      if (!row?.editor_state?.standard || row.editor_state.result?.status !== 'generated') throw Error();
      const opened = { ...row.editor_state, title: row.title };
      setEditor(opened);
      setSavedEditor(opened);
      setSavedId(row.id);
      pendingPlanId.current = '';
      setFeedback('저장한 수업안을 열었습니다.');
    } catch {
      setError('저장한 수업안을 열지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await fetch(new URL('/auth/v1/token?grant_type=password', url), {
        method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
        body: JSON.stringify({ email: fields.get('email'), password: fields.get('password') }),
      });
      if (!response.ok) throw Error();
      const session = await response.json();
      if (typeof session.user?.id !== 'string' || typeof session.access_token !== 'string') throw Error();
      const list = await fetch(new URL('/rest/v1/curriculum_standards?select=code,official_text,official_source&order=code', url), {
        headers: { apikey: anon, authorization: 'Bearer ' + session.access_token },
      });
      if (!list.ok) throw Error();
      if (session.user.id !== editorOwner) {
        setEditor(undefined);
        setSavedEditor(undefined);
        setSavedId('');
        pendingPlanId.current = '';
        setSelected('');
        setQuery('');
        setSourceId('');
        setSources([]);
        setVolumeFilter(0);
        setSourceStatus('idle');
      }
      setSaved([]);
      setSavedQuery('');
      setFeedback('');
      setEditorOwner(session.user.id);
      setStandards(await list.json());
      setToken(session.access_token);
      await loadSavedPlans(session.access_token);
    } catch {
      setError('로그인하거나 성취기준을 불러오지 못했습니다. 연결 설정과 계정을 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!confirmDiscard()) return;
    setBusy(true);
    setToken('');
    setEditorOwner('');
    setEditor(undefined);
    setSavedEditor(undefined);
    setSavedId('');
    pendingPlanId.current = '';
    setSaved([]);
    setSavedQuery('');
    setSavedListFailed(false);
    setStandards([]);
    setSelected('');
    setQuery('');
    setSourceId('');
    setSources([]);
    setVolumeFilter(0);
    setSourceStatus('idle');
    setError('');
    setFeedback('');
    try {
      const response = await fetch(new URL('/auth/v1/logout?scope=local', url), {
        method: 'POST',
        headers: { apikey: anon, authorization: 'Bearer ' + token },
      });
      if (!response.ok) throw Error();
      setFeedback('로그아웃했습니다.');
    } catch {
      setError('이 화면에서 로그아웃했습니다. 서버 세션 종료는 확인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!standard || !source?.generation_available || sourceStatus !== 'ready') return;
    const fields = new FormData(event.currentTarget);
    const lesson = Number(fields.get('lesson'));
    const totalLessons = Number(fields.get('totalLessons'));
    if (lesson > totalLessons) {
      setError('설계할 차시는 전체 차시 이내로 입력해 주세요.');
      return;
    }
    if (!confirmDiscard()) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/lessons/generate', {
        method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({
          standardCode: selected, evidenceId: source.id, volume: source.volume,
          editionId: source.edition_id, unitId: source.unit_id,
          lesson, totalLessons,
          minutes: Number(fields.get('minutes')), equipment: String(fields.get('equipment')).split(',').map(s => s.trim()).filter(Boolean),
          studentConditions: String(fields.get('studentConditions')).trim(),
        }),
      });
      if (response.status === 401) setToken('');
      const data = await response.json().catch(error => {
        if (error instanceof SyntaxError) return null;
        throw error;
      });
      if (!response.ok || data?.status !== 'generated') {
        setError(messages[data?.status] ?? '수업안을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      const generationStandard: Standard = data.officialStandard ?? standard;
      setEditor({ result: data, standard: generationStandard, title: generationStandard.code + ' 탐구 수업안' });
      setSavedId('');
      pendingPlanId.current = '';
      setSavedEditor(undefined);
      setFeedback('');
    } catch (error) {
      const timedOut = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
      setError(timedOut ? '수업안 생성 응답 시간이 초과됐습니다. 입력을 확인한 뒤 다시 시도해 주세요.'
        : '연결이 끊겼습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  if (!url || !anon) return <p role="status">교사 계정 연결에 필요한 서버 설정이 아직 없습니다.</p>;
  const standardQuery = normalizeStandardSearch(query);
  const matching = standards.filter(row =>
    normalizeStandardSearch(row.code).includes(standardQuery) ||
    normalizeStandardSearch(row.official_text).includes(standardQuery));
  const matchingPlans = saved.filter(plan => plan.title.toLowerCase().includes(savedQuery.trim().toLowerCase()));
  return <>
    {error && <p role="alert">{error}</p>}
    {feedback && <p className="controls" role="status">{feedback}</p>}
    {token && <button className="controls" type="button" disabled={busy} onClick={logout}>로그아웃</button>}
    {token && savedListFailed && <div className="controls">
      <p role="alert">저장한 수업안 목록을 불러오지 못했습니다.</p>
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await loadSavedPlans(token); }
        finally { setBusy(false); }
      }}>저장 목록 다시 불러오기</button>
    </div>}
    {token && saved.length > 0 && <section className="controls">
      <h2>저장한 수업안</h2>
      <label>저장한 수업안 제목 검색<input type="search" value={savedQuery}
        onChange={event => setSavedQuery(event.target.value)}/></label>
      {matchingPlans.length === 0 ? <p role="status">검색한 제목의 수업안이 없습니다.</p> : <ul>{matchingPlans.map(plan => <li key={plan.id}>
        <button type="button" disabled={busy} onClick={() => openPlan(plan.id)}>{plan.title} 열기</button>
      </li>)}</ul>}
    </section>}
    {!token ? <form onSubmit={login} className="controls">
      <label>교사 이메일<input name="email" type="email" required autoComplete="username"/></label>
      <label>비밀번호<input name="password" type="password" required autoComplete="current-password"/></label>
      <button disabled={busy}>{busy ? '연결 중…' : '로그인'}</button>
    </form> : <form onSubmit={generate} className="controls">
      <label>성취기준 검색<input value={query} onChange={e => setQuery(e.target.value)} placeholder="코드 또는 키워드"/></label>
      <label>성취기준<select value={selected} required onChange={e => {
        setSelected(e.target.value);
        setSourceId('');
        setSources([]);
        setSourceStatus(e.target.value ? 'loading' : 'idle');
      }}>
        <option value="">선택하세요</option>
        {standard && !matching.includes(standard) && <option value={standard.code}>{standard.code}</option>}
        {matching.map(row => <option key={row.code} value={row.code}>{row.code} {row.official_text}</option>)}
      </select></label>
      {!matching.length && <p role="status">{standards.length ? '검색 결과가 없습니다.' : '등록된 검증 성취기준이 없습니다.'}</p>}
      {standard && <p><strong>공식 원문</strong> {standard.official_text}<br/>{standard.official_source}
        {officialSourceUrl(standard.official_source) && <> <a href={officialSourceUrl(standard.official_source)}>교육부 고시 열기</a></>}
      </p>}
      {sourceStatus === 'loading' && <p role="status">교과서 근거를 확인하고 있습니다.</p>}
      {sourceStatus === 'error' && <p role="alert">교과서 근거를 불러오지 못했습니다. <button type="button" onClick={() => setLookupAttempt(n => n + 1)}>다시 조회</button></p>}
      {sources.length > 0 && <fieldset className="source-filters">
        <legend>교과서 범위</legend>
        {[0, 1, 2, 3].map(volume => <button type="button" key={volume} aria-pressed={volumeFilter === volume}
          onClick={() => {
            setVolumeFilter(volume);
            if (volume !== 0 && source?.volume !== volume) setSourceId('');
          }}>{volume === 0 ? '전체' : `과학 ${volume}`}</button>)}
      </fieldset>}
      {sourceStatus === 'ready' && matchingSources.length === 0 && <p role="status">
        <strong>수업에 사용할 교과서 근거 미확보</strong><br/>
        {sources.length === 0
          ? '이 성취기준에 연결된 근거 중 현재 표시할 수 있는 자료가 없습니다.'
          : '선택한 교과서에서 표시할 수 있는 근거가 없습니다.'}
      </p>}
      {sourceStatus === 'ready' && matchingSources.length > 0 && <p role="status">
        교과서 근거 {matchingSources.length}구간 · 수업안 생성 가능 {matchingSources.filter(row => row.generation_available).length}구간
      </p>}
      {matchingSources.length > 0 && <label>교과서 판본·단원·차시<select value={sourceId} onChange={e => setSourceId(e.target.value)} required>
        <option value="">검증된 근거를 선택하세요</option>
        {matchingSources.map(row => <option key={row.id} value={row.id}>
          과학 {row.volume} · {row.revision} 개정 · {row.edition_id} · {row.unit_id} · {lessonLabel(row.lesson, row.lesson_end)} · {row.printed_page_start}–{row.printed_page_end}쪽
        </option>)}
      </select></label>}
      {source && <p>
        {scopeLabel(source.alignment_scope, source.supports_entire_standard)}<br/>
        {source.volume === 3 ? '2015 개정 교과서 내용 참고. 수업 기준은 2022 개정 성취기준입니다. ' : ''}
        {source.lesson_basis === 'unassigned' ? '출판사 차시 미확인. 설계할 차시는 교사가 지정합니다. '
          : source.lesson_basis === 'teacher' ? '교사 지정 차시. ' : '출판사 자료에 명시된 차시. '}
        {!source.generation_available && '이 근거의 API 전송은 승인되지 않았습니다. '}
        {source.source_url && /^https?:\/\//i.test(source.source_url) && <a href={source.source_url}>출처 열기</a>}
      </p>}
      <div className="grid">
        {source && <label>설계할 차시<input key={sourceId + '-lesson'} name="lesson" type="number"
          min={source.lesson ?? 1} max={source.lesson_end ?? undefined} required defaultValue={source.lesson ?? ''}/></label>}
        <label>{source?.total_unit_lessons ? '전체 차시 (교과서 기준)' : '전체 차시 (교사 입력)'}
          <input key={sourceId} name="totalLessons" type="number" min={source?.lesson_end ?? 1} required
            readOnly={source?.total_unit_lessons != null} defaultValue={source?.total_unit_lessons ?? ''}/>
        </label>
        <label>수업 시간(분)<input name="minutes" type="number" min="1" max="600" required defaultValue="45"/></label>
      </div>
      <label>사용 가능 장비<input name="equipment" placeholder="쉼표로 구분"/></label>
      <label>학급 조건<input name="studentConditions" maxLength={400} aria-describedby="class-conditions-help"
        placeholder="예: 4명씩 모둠, 측정 도구 사용 경험 없음"/></label>
      <small id="class-conditions-help">학생 이름 등 개인정보를 제외한 학급 조건을 입력해 주세요. 입력한 조건은 생성과 저장 및 PDF 출력에 사용됩니다.</small>
      <button disabled={busy || !source?.generation_available || sourceStatus !== 'ready'}>{busy ? '생성 중…' : '수업안 생성'}</button>
    </form>}
    {token && editor && result && <article>
      <p className="controls" role="status">{hasUnsavedPlan ? '저장하지 않은 변경 사항이 있습니다.' : '현재 수업안이 저장되어 있습니다.'}</p>
      <h2>{editor.title || '탐구 수업안'}</h2>
      {result.designedLesson && <p>설계 범위 {result.designedLesson.total}차시 중 {result.designedLesson.lesson}차시</p>}
      {result.references.some(ref => ref.supportsEntireStandard === false) && <p>
        <strong>교과서 부분 근거 사용</strong> · 교사는 근거가 다루는 범위와 성취기준의 나머지 수행을 확인해 주세요.
      </p>}
      {Array.isArray(result.plannedEquipment) && <p>입력한 장비 {result.plannedEquipment.join(', ') || '없음'}</p>}
      {result.plannedClassConditions && <p>입력한 학급 조건 {result.plannedClassConditions}</p>}
      <label className="controls">수업안 제목<input disabled={busy} value={editor.title} maxLength={160}
        onChange={e => setEditor({ ...editor, title: e.target.value })}/></label>
      <p><strong>2022 개정 성취기준 공식 원문 {editor.standard.code}</strong><br/>
        {editor.standard.official_text}<br/>{editor.standard.official_source}
        {officialSourceUrl(editor.standard.official_source) && <> <a className="controls"
          href={officialSourceUrl(editor.standard.official_source)}>생성 당시 교육부 고시 열기</a></>}
      </p>
      <section aria-labelledby="alignment-check-title">
        <h3 id="alignment-check-title">교육과정 일치 점검</h3>
        <p role="status">교사 확인 {verifiedCount}/{alignmentKeys.length}개
          {verifiedCount === alignmentKeys.length ? ' · 모든 항목 확인' : ''}</p>
        <p>아래 항목을 성취기준 원문과 수업안에 대조해 확인하세요. 수업안 본문을 수정하면 다시 점검해야 합니다.</p>
        <ul>{alignmentKeys.map(key => <li key={key}>
          <label className="check-option controls">
            <input type="checkbox" disabled={busy} checked={editor.verifiedChecks?.[key] === true}
              onChange={e => setEditor({ ...editor, verifiedChecks: { ...editor.verifiedChecks, [key]: e.target.checked } })}/>
            <span>{alignmentChecks[key]}</span>
          </label>
          <span className="print-content">{editor.verifiedChecks?.[key] ? '교사 확인' : '확인 필요'} · {alignmentChecks[key]}</span>
        </li>)}</ul>
        <label className="controls">교사 점검 메모
          <textarea disabled={busy} value={editor.alignmentNotes ?? ''} maxLength={1000}
            onChange={event => setEditor({ ...editor, alignmentNotes: event.target.value })}/>
        </label>
        {editor.alignmentNotes?.trim() && <p className="print-content">교사 점검 메모 · {editor.alignmentNotes}</p>}
      </section>
      <p><strong>수업 설계</strong> · AI 생성 초안과 교사가 편집한 내용</p>
      {(Object.keys(lessonSections) as Key[]).map(key => <section key={key}>
        <h3>{lessonSections[key]}</h3>
        <textarea className="controls" disabled={busy} aria-label={lessonSections[key]} value={result.draft[key]} onChange={e => {
          setEditor({ ...editor, verifiedChecks: {}, result: { ...result, draft: { ...result.draft, [key]: e.target.value } } });
        }}/>
        <p className="print-content">{result.draft[key]}</p>
        {key === 'record' && result.draft.recordingTable && <>
          <label className="controls">기록표 빈 행 수
            <select disabled={busy} value={result.draft.recordingTable.rowCount} onChange={e => {
              setEditor({ ...editor, verifiedChecks: {}, result: { ...result, draft: { ...result.draft,
                recordingTable: { ...result.draft.recordingTable, rowCount: Number(e.target.value) },
              } } });
            }}>
              {[2, 3, 4, 5, 6, 7, 8].map(count => <option key={count}>{count}</option>)}
            </select>
          </label>
          {!validColumnTitles && <p className="controls" role="status">기록표의 열 제목을 모두 입력하고 서로 다르게 지정해 주세요.</p>}
          <table className="record-table">
          <caption>학생 관찰·측정 기록표</caption>
          <thead><tr>{result.draft.recordingTable.columns.map((column, index) => <th key={index} scope="col">
            <input className="controls" disabled={busy} aria-label={`기록표 열 ${index + 1}`} value={column} maxLength={60}
              onChange={e => {
                const columns = result.draft.recordingTable.columns.map((label, i) => i === index ? e.target.value : label);
                setEditor({ ...editor, verifiedChecks: {}, result: { ...result, draft: { ...result.draft,
                  recordingTable: { ...result.draft.recordingTable, columns },
                } } });
              }}/>
            <span className="print-content">{column}</span>
          </th>)}</tr></thead>
          <tbody>{Array.from({ length: result.draft.recordingTable.rowCount }, (_, row) => <tr key={row}>
            {result.draft.recordingTable.columns.map((_, column) => <td key={column}></td>)}
          </tr>)}</tbody>
          </table>
        </>}
      </section>)}
      <h3>시간 배분</h3>
      <p>계획 {plannedMinutes}분 · 단계 합계 {phaseMinutes}분</p>
      {!validTiming && <p className="controls" role="status">각 단계의 활동과 시간을 입력하고 합계를 계획 시간에 맞춰 주세요.</p>}
      <ol>{result.draft.phases.map((phase, index) => {
        const startMinute = result.draft.phases.slice(0, index).reduce((total, item) => total + item.minutes, 0);
        const timing = validTiming ? `${startMinute}–${startMinute + phase.minutes}분` : '';
        function editPhase(change: Partial<typeof phase>) {
          const phases = result!.draft.phases.map((item, i) => i === index ? { ...item, ...change } : item);
          editPhases(phases);
        }
        return <li key={index}>
          <div className="grid controls">
            <label>{index + 1}단계 활동<input disabled={busy} value={phase.activity} maxLength={300}
              onChange={e => editPhase({ activity: e.target.value })}/></label>
            <label>{index + 1}단계 시간(분)<input type="number" disabled={busy} min={1} max={plannedMinutes} step={1}
              value={phase.minutes || ''} onChange={e => editPhase({ minutes: Number(e.target.value) })}/></label>
            <button type="button" disabled={busy || result.draft.phases.length === 1}
              onClick={() => editPhases(result.draft.phases.filter((_, i) => i !== index))}>{index + 1}단계 삭제</button>
          </div>
          {timing && <span className="controls">수업 시작 기준 {timing}</span>}
          <span className="print-content">{phase.activity} ({phase.minutes}분){timing && ` · ${timing}`}</span>
        </li>;
      })}</ol>
      <button type="button" className="controls" disabled={busy || result.draft.phases.length >= plannedMinutes}
        onClick={() => editPhases([...result.draft.phases, { activity: '', minutes: 0 }])}>활동 단계 추가</button>
      <h3>교과서 근거</h3>
      <ul>{result.references.map(ref => <li key={ref.id}>
        과학 {ref.volume} ({ref.revision} 개정{ref.volume === 3 ? ', 내용 참고' : ''}), {ref.editionId}, {ref.unitId}, {ref.printedPages.join('–')}쪽, {lessonLabel(ref.lesson, ref.lessonEnd)}{ref.lessonBasis === 'teacher' ? ' (교사 지정)' : ref.lessonBasis === 'publisher' ? ' (출판사 자료)' : ''}
        {ref.sourceUrl && /^https?:\/\//i.test(ref.sourceUrl) && <> <a href={ref.sourceUrl}>출처</a><span className="print-content">{ref.sourceUrl}</span></>}
        <br/><span>{scopeLabel(ref.alignmentScope, ref.supportsEntireStandard)}</span>
      </li>)}</ul>
      <button className="controls" disabled={busy || !token || !editor.title.trim() || !validTiming || !validColumnTitles} onClick={savePlan}>수업안 저장</button>
      <button className="controls" disabled={busy || !validTiming || !validColumnTitles} onClick={() => window.print()}>인쇄 / PDF 저장</button>
    </article>}
  </>;
}
