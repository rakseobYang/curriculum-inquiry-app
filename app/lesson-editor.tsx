'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import standardsData from '../data/standards.json';
import { lessonSections, type LessonDraft, type LessonSection, type OfficialStandard } from '../lib/lesson-schema.ts';
import { createBackup, listPlans, parseBackup, removePlan, savePlan, savePlans,
  type StoredPlan } from '../lib/plan-store.ts';

type Standard = OfficialStandard;
type Generated = {
  status: 'generated';
  generationMode: 'official-curriculum-only';
  alignmentStatus: 'teacher-review';
  officialStandard: { code: string; official_text: string; official_source: string };
  designedLesson: { lesson: number; total: number };
  plannedMinutes: number;
  plannedEquipment: string[];
  plannedClassConditions: string;
  draft: LessonDraft;
  references: [];
};
type EditorState = {
  result: Generated;
  standard: Standard;
  title: string;
  verifiedChecks?: Partial<Record<AlignmentCheck, boolean>>;
  alignmentNotes?: string;
};
type AlignmentCheck = 'content' | 'performance' | 'evidence' | 'assessment';
type SavedPlan = StoredPlan;
type TurnstileApi = {
  render: (target: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi }
}

const standards = standardsData as Standard[];
const generationUrl = process.env.NEXT_PUBLIC_GENERATION_API_URL?.trim() ?? '';
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? '';
const alignmentChecks: Record<AlignmentCheck, string> = {
  content: '학습 목표와 핵심 개념이 성취기준의 내용에 맞습니다.',
  performance: '학생이 성취기준에서 요구하는 수행을 직접 합니다.',
  evidence: '학생이 관찰하거나 수집한 자료를 근거로 설명합니다.',
  assessment: '평가가 성취기준의 수행과 새로운 실생활 문제 적용을 확인합니다.',
};
const alignmentKeys = Object.keys(alignmentChecks) as AlignmentCheck[];
const generationMessages: Record<string, string> = {
  'service-unconfigured': 'AI 생성 서비스가 설정되지 않았습니다. Workers와 Turnstile 설정을 확인해 주세요.',
  'invalid-input': '입력한 차시와 수업 조건을 확인해 주세요.',
  'input-too-large': '입력 내용이 허용 크기를 넘었습니다. 입력을 줄여 주세요.',
  'standard-unverified': '공식 확인된 2022 개정 성취기준이 없습니다.',
  'origin-not-allowed': '이 사이트에서 생성 요청을 보낼 수 없습니다.',
  'verification-failed': '자동 요청 방지 확인을 완료해 주세요.',
  'verification-unavailable': '요청 확인 서비스에 연결하지 못했습니다. 다시 시도해 주세요.',
  'generation-limit': '이 네트워크의 오늘 생성 한도에 도달했습니다. 나중에 다시 시도해 주세요.',
  'rate-limit-unavailable': '사용량 제한 서비스를 확인할 수 없어 생성을 중단했습니다.',
  'model-unavailable': 'AI 모델에 연결하지 못했습니다. 가짜 응답으로 대체하지 않았습니다.',
  'model-output-invalid': 'AI 초안의 형식이나 시간 합계를 검증하지 못했습니다.',
};
const sections = Object.keys(lessonSections) as LessonSection[];

function normalizeSearch(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\[\]]/gu, '').replace(/[–—−]/gu, '-');
}

function officialSourceUrl(source: string) {
  const url = source.match(/https:\/\/[^\s]+$/u)?.[0];
  return url && URL.canParse(url) ? url : undefined;
}

function isEditorState(value: unknown): value is EditorState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Partial<EditorState>;
  const standard = state.standard;
  const result = state.result;
  return Boolean(standard?.verified === true && standard.curriculum === '2022' && result?.status === 'generated' &&
    result.generationMode === 'official-curriculum-only' && result.alignmentStatus === 'teacher-review' &&
    result.references.length === 0 && Number.isSafeInteger(result.plannedMinutes) &&
    typeof state.title === 'string');
}

export default function LessonEditor() {
  const [databaseStatus, setDatabaseStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saved, setSaved] = useState<SavedPlan[]>([]);
  const [savedQuery, setSavedQuery] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [editor, setEditor] = useState<EditorState>();
  const [editorId, setEditorId] = useState('');
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [generationUnavailable, setGenerationUnavailable] = useState(false);
  const turnstileContainer = useRef<HTMLDivElement>(null);
  const turnstileWidget = useRef<string | undefined>(undefined);
  const backupInput = useRef<HTMLInputElement>(null);
  const standard = standards.find(row => row.code === selected);
  const result = editor?.result;
  const matchingStandards = standards.filter(row =>
    normalizeSearch(row.code).includes(normalizeSearch(query)) ||
    normalizeSearch(row.official_text).includes(normalizeSearch(query)));
  const matchingPlans = saved.filter(plan => plan.title.toLocaleLowerCase().includes(savedQuery.trim().toLocaleLowerCase()));
  const phaseMinutes = result?.draft.phases.reduce((total, phase) => total + phase.minutes, 0) ?? 0;
  const plannedMinutes = result?.plannedMinutes ?? phaseMinutes;
  const validTiming = Boolean(result && phaseMinutes === plannedMinutes && result.draft.phases.every(phase =>
    phase.activity.trim() && Number.isSafeInteger(phase.minutes) && phase.minutes > 0));
  const columns = result?.draft.recordingTable.columns ?? [];
  const validColumns = columns.length >= 2 && columns.every(column => column.trim()) &&
    new Set(columns.map(column => column.trim())).size === columns.length;
  const verifiedCount = alignmentKeys.filter(key => editor?.verifiedChecks?.[key] === true).length;
  const hasUnsavedPlan = Boolean(editor && JSON.stringify(editor) !== savedSnapshot);

  useEffect(() => {
    let active = true;
    listPlans().then(rows => {
      if (!active) return;
      setSaved(rows);
      setDatabaseStatus('ready');
    }).catch(() => {
      if (!active) return;
      setDatabaseStatus('error');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!generationUrl || !turnstileSiteKey || !turnstileContainer.current) {
      setGenerationUnavailable(true);
      return;
    }
    let active = true;
    let script = document.querySelector<HTMLScriptElement>('#cloudflare-turnstile-script');
    const render = () => {
      if (!active || !window.turnstile || !turnstileContainer.current || turnstileWidget.current) return;
      turnstileWidget.current = window.turnstile.render(turnstileContainer.current, {
        sitekey: turnstileSiteKey,
        action: 'generate',
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => { setTurnstileToken(''); setError('자동 요청 방지 확인에 실패했습니다. 다시 시도해 주세요.'); },
      });
      setTurnstileReady(true);
    };
    if (window.turnstile) render();
    else {
      if (!script) {
        script = document.createElement('script');
        script.id = 'cloudflare-turnstile-script';
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', render);
      script.addEventListener('error', () => setGenerationUnavailable(true));
    }
    return () => {
      active = false;
      script?.removeEventListener('load', render);
      if (turnstileWidget.current && window.turnstile) window.turnstile.remove(turnstileWidget.current);
      turnstileWidget.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!hasUnsavedPlan) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = true; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedPlan]);

  function confirmDiscard() {
    return !hasUnsavedPlan || window.confirm('저장하지 않은 수업안이 있습니다. 현재 수업안을 닫을까요?');
  }

  async function refreshPlans() {
    const rows = await listPlans();
    setSaved(rows);
    setDatabaseStatus('ready');
  }

  function editDraft(change: Partial<LessonDraft>) {
    if (!editor || !result) return;
    setEditor({ ...editor, verifiedChecks: {}, result: { ...result,
      draft: { ...result.draft, ...change } } });
  }

  async function saveCurrentPlan() {
    if (!editor || !editor.title.trim() || !validTiming || !validColumns || databaseStatus !== 'ready') return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const now = new Date().toISOString();
      const previous = saved.find(row => row.id === editorId);
      const plan: SavedPlan = {
        id: editorId || crypto.randomUUID(),
        title: editor.title.trim(),
        editorState: editor as unknown as Record<string, unknown>,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      await savePlan(plan);
      setEditorId(plan.id);
      setSavedSnapshot(JSON.stringify(editor));
      await refreshPlans();
      setFeedback('이 브라우저에 수업안을 저장했습니다.');
    } catch {
      setError('브라우저 저장 공간에 기록하지 못했습니다. 편집 내용은 화면에 남아 있습니다.');
    } finally { setBusy(false); }
  }

  function openPlan(plan: SavedPlan) {
    if (!confirmDiscard()) return;
    const state = plan.editorState as unknown as EditorState;
    if (!isEditorState(state)) { setError('저장 자료의 형식을 확인할 수 없습니다.'); return; }
    setEditor(state);
    setEditorId(plan.id);
    setSavedSnapshot(JSON.stringify(state));
    setSelected(state.standard.code);
    setFeedback('브라우저에 저장된 수업안을 열었습니다.');
    setError('');
  }

  async function deletePlan(plan: SavedPlan) {
    if (!window.confirm(`“${plan.title}” 수업안을 이 브라우저에서 삭제할까요?`)) return;
    setError('');
    try {
      await removePlan(plan.id);
      if (editorId === plan.id) {
        setEditor(undefined);
        setEditorId('');
        setSavedSnapshot('');
      }
      await refreshPlans();
      setFeedback('이 브라우저의 저장 자료를 삭제했습니다.');
    } catch { setError('수업안을 삭제하지 못했습니다.'); }
  }

  function startNewPlan() {
    if (!confirmDiscard()) return;
    setEditor(undefined);
    setEditorId('');
    setSavedSnapshot('');
    setFeedback('새 수업안을 준비합니다.');
    setError('');
  }

  function downloadBackup() {
    if (databaseStatus !== 'ready') return;
    const blob = new Blob([JSON.stringify(createBackup(saved), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `curriculum-inquiry-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setFeedback('백업 파일을 내려받았습니다. 안전한 위치에 보관해 주세요.');
  }

  async function restoreBackup(file?: File) {
    if (!file) return;
    if (!window.confirm('백업에 든 수업안을 복원할까요? 같은 ID의 자료는 백업 내용으로 바뀌고 나머지 저장 자료는 유지됩니다.')) {
      if (backupInput.current) backupInput.current.value = '';
      return;
    }
    setBusy(true);
    setError('');
    try {
      const rows = await parseBackup(file);
      await savePlans(rows);
      await refreshPlans();
      setFeedback(`${rows.length}개 수업안을 이 브라우저에 복원했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '백업을 복원하지 못했습니다.');
    } finally {
      setBusy(false);
      if (backupInput.current) backupInput.current.value = '';
    }
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!standard || !generationUrl || !turnstileSiteKey || !turnstileToken || databaseStatus === 'error') return;
    const fields = new FormData(event.currentTarget);
    const lesson = Number(fields.get('lesson'));
    const totalLessons = Number(fields.get('totalLessons'));
    const minutes = Number(fields.get('minutes'));
    if (!Number.isSafeInteger(lesson) || !Number.isSafeInteger(totalLessons) || lesson > totalLessons ||
        !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 300) {
      setError('차시와 수업 시간을 확인해 주세요. 전체 1–50차시, 수업 시간 1–300분을 입력합니다.');
      return;
    }
    if (!confirmDiscard()) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const response = await fetch(generationUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          standardCode: standard.code,
          lesson,
          totalLessons,
          minutes,
          equipment: String(fields.get('equipment') ?? '').split(',').map(value => value.trim()).filter(Boolean),
          studentConditions: String(fields.get('studentConditions') ?? '').trim(),
          turnstileToken,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.status !== 'generated' || data?.generationMode !== 'official-curriculum-only') {
        setError(generationMessages[data?.status] ?? '수업안을 생성하지 못했습니다. 실제 AI 응답을 확인해 주세요.');
        return;
      }
      const next: EditorState = { result: data as Generated, standard, title: `${standard.code} 교육과정 기반 수업안` };
      if (!isEditorState(next)) { setError('AI 응답 형식을 검증하지 못했습니다.'); return; }
      setEditor(next);
      setEditorId('');
      setSavedSnapshot('');
      setFeedback('실제 AI 초안입니다. 공식 교육과정 기반이며 교과서와 연계하지 않았습니다.');
    } catch (cause) {
      const timeout = cause instanceof DOMException && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
      setError(timeout ? '30초 안에 응답하지 않아 생성을 중단했습니다. 다시 확인해 주세요.'
        : 'Workers 연결에 실패했습니다. 설정을 확인해 주세요.');
    } finally {
      setBusy(false);
      setTurnstileToken('');
      if (turnstileWidget.current && window.turnstile) window.turnstile.reset(turnstileWidget.current);
    }
  }

  const matchingSaved = matchingPlans;
  return <>
    <aside className="storage-notice" role="note">
      저장한 수업안은 이 브라우저의 IndexedDB에만 보관됩니다. 브라우저 프로필·기기를 바꾸거나 사이트 데이터를 지우면 사라질 수 있으니 백업 파일을 내려받아 보관해 주세요.
    </aside>
    {error && <p role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {databaseStatus === 'loading' && <p role="status">이 브라우저의 저장 공간을 확인하고 있습니다.</p>}
    {databaseStatus === 'error' && <p role="alert">IndexedDB를 사용할 수 없습니다. 브라우저의 사이트 저장 권한과 여유 공간을 확인해 주세요.</p>}
    <section className="controls saved-plans" aria-labelledby="saved-plans-title">
      <h2 id="saved-plans-title">내 수업안 · 이 브라우저</h2>
      <div className="grid">
        <label>저장한 수업안 검색<input type="search" value={savedQuery}
          onChange={event => setSavedQuery(event.target.value)} placeholder="제목 검색"/></label>
        <button type="button" disabled={databaseStatus !== 'ready' || busy} onClick={downloadBackup}>백업 다운로드</button>
        <label className="file-label">백업 복원<input ref={backupInput} type="file" accept="application/json,.json"
          disabled={databaseStatus !== 'ready' || busy} onChange={event => void restoreBackup(event.target.files?.[0])}/></label>
        <button type="button" disabled={busy} onClick={startNewPlan}>새 수업안</button>
      </div>
      {databaseStatus === 'ready' && saved.length === 0 && <p role="status">아직 이 브라우저에 저장된 수업안이 없습니다.</p>}
      {saved.length > 0 && matchingSaved.length === 0 && <p role="status">검색 결과가 없습니다.</p>}
      {matchingSaved.length > 0 && <ul className="saved-list">{matchingSaved.map(plan => <li key={plan.id}>
        <span>{plan.title}<small>수정 {new Date(plan.updatedAt).toLocaleString('ko-KR')}</small></span>
        <button type="button" disabled={busy} onClick={() => openPlan(plan)}>열기</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void deletePlan(plan)}>삭제</button>
      </li>)}</ul>}
    </section>

    <form className="controls" onSubmit={event => void generate(event)}>
      <h2>수업안 입력</h2>
      <p><strong>공식 교육과정 기반 생성</strong> · 선택한 2022 개정 성취기준을 기준으로 AI 초안을 작성합니다.</p>
      <label>성취기준 검색<input value={query} onChange={event => setQuery(event.target.value)} placeholder="코드 또는 공식 원문 키워드"/></label>
      <label>2022 개정 중학교 과학 성취기준<select value={selected} required onChange={event => setSelected(event.target.value)}>
        <option value="">성취기준 선택</option>
        {matchingStandards.map(row => <option key={row.code} value={row.code}>{row.code} {row.official_text}</option>)}
      </select></label>
      {matchingStandards.length === 0 && <p role="status">검색 결과가 없습니다.</p>}
      {standard && <section className="standard-card" aria-label="공식 성취기준 근거">
        <p><strong>교육과정 공식 원문 · 2022 개정</strong><br/>{standard.official_text}</p>
        <p>출처: {standard.official_source} · 데이터 기준 커밋 {standard.dataset_commit}</p>
        {officialSourceUrl(standard.official_source) && <a href={officialSourceUrl(standard.official_source)} target="_blank" rel="noreferrer">교육부 고시 열기</a>}
        <p className="evidence-status"><strong>교과서 연계 생성 불가</strong><br/>
          공개 배포본에는 표시와 외부 전송이 승인된 교과서 근거가 없습니다. 교과서 쪽수·차시를 추정하지 않습니다. 과학 3 자료는 2015 개정 참고 자료이며 2022 개정 교과서로 표시하지 않습니다.</p>
      </section>}
      <div className="grid">
        <label>설계할 차시<input name="lesson" type="number" min="1" max="50" required defaultValue="1"/></label>
        <label>전체 차시<input name="totalLessons" type="number" min="1" max="50" required defaultValue="1"/></label>
        <label>수업 시간(분)<input name="minutes" type="number" min="1" max="300" required defaultValue="45"/></label>
      </div>
      <label>사용 가능한 장비<input name="equipment" maxLength={1200} placeholder="쉼표로 구분"/></label>
      <label>학급 조건<input name="studentConditions" maxLength={400} placeholder="예: 4명씩 모둠, 측정 도구 사용 경험 없음"/></label>
      <small>학생 이름 등 개인정보나 건강·가정 정보를 입력하지 마세요. 입력 내용과 공식 성취기준은 Workers를 거쳐 OpenAI로 전송됩니다.</small>
      {!generationUrl || !turnstileSiteKey || generationUnavailable
        ? <p role="status">실시간 AI 생성 설정이 아직 없습니다. Workers API 주소와 Turnstile 공개 사이트 키가 설정되기 전까지 생성하지 않습니다.</p>
        : <div className="turnstile-wrap"><p>자동 요청 방지 확인을 완료해야 실제 AI를 호출할 수 있습니다.</p><div ref={turnstileContainer} />
          {!turnstileReady && <small>Turnstile을 불러오는 중입니다.</small>}</div>}
      <button disabled={busy || databaseStatus !== 'ready' || !standard || !generationUrl || !turnstileSiteKey || !turnstileToken}>
        {busy ? '실제 AI 생성 중…' : '교육과정 기반 AI 초안 생성'}
      </button>
    </form>

    {editor && result && <article>
      <p role="status"><strong>공식 교육과정 기반 AI 초안 · 교과서 연계 아님</strong></p>
      <p className="review-warning">교사 내용 검토 필요 · 성취기준 적용, 과학적 정확성, 탐구 실행 가능성, 안전, 평가를 확인하세요. AI 초안은 교육과정 일치를 확정하지 않습니다.</p>
      {hasUnsavedPlan && <p role="status">저장하지 않은 변경 사항이 있습니다.</p>}
      {!hasUnsavedPlan && editorId && <p role="status">현재 수업안은 이 브라우저에 저장되어 있습니다.</p>}
      <label className="controls">수업안 제목<input value={editor.title} maxLength={160}
        onChange={event => setEditor({ ...editor, title: event.target.value })}/></label>
      <p>설계 차시 {result.designedLesson.lesson} / 전체 {result.designedLesson.total}차시 · 수업 {result.plannedMinutes}분</p>
      <p>준비물 {result.plannedEquipment.join(', ') || '없음'}</p>
      {result.plannedClassConditions && <p>학급 조건 {result.plannedClassConditions}</p>}
      <p><strong>2022 개정 성취기준 공식 원문 {editor.standard.code}</strong><br/>{editor.standard.official_text}<br/>{editor.standard.official_source}</p>
      {officialSourceUrl(editor.standard.official_source) && <a className="controls" href={officialSourceUrl(editor.standard.official_source)} target="_blank" rel="noreferrer">생성 당시 교육부 고시 열기</a>}
      <section aria-labelledby="alignment-check-title">
        <h3 id="alignment-check-title">교육과정 일치 점검 · 교사 확인 필요</h3>
        <p role="status">교사 확인 {verifiedCount}/{alignmentKeys.length}개</p>
        <p>수업안과 공식 원문을 대조해 확인하세요. 본문을 수정하면 모든 확인 표시가 초기화됩니다.</p>
        <ul>{alignmentKeys.map(key => <li key={key}>
          <label className="check-option controls"><input type="checkbox" checked={editor.verifiedChecks?.[key] === true}
            onChange={event => setEditor({ ...editor, verifiedChecks: { ...editor.verifiedChecks, [key]: event.target.checked } })}/>
            <span>{alignmentChecks[key]}</span></label>
          <span className="print-content">{editor.verifiedChecks?.[key] ? '교사 확인' : '확인 필요'} · {alignmentChecks[key]}</span>
        </li>)}</ul>
        <label className="controls">교사 점검 메모<textarea maxLength={1000} value={editor.alignmentNotes ?? ''}
          onChange={event => setEditor({ ...editor, alignmentNotes: event.target.value })}/></label>
        {editor.alignmentNotes?.trim() && <p className="print-content">교사 점검 메모 · {editor.alignmentNotes}</p>}
      </section>
      <p><strong>수업 설계</strong> · AI 작성 초안과 교사 편집 내용</p>
      {sections.map(key => <section key={key}>
        <h3>{lessonSections[key]}</h3>
        <textarea className="controls" aria-label={lessonSections[key]} value={result.draft[key]}
          onChange={event => setEditor({ ...editor, verifiedChecks: {}, result: { ...result,
            draft: { ...result.draft, [key]: event.target.value } } })}/>
        <p className="print-content">{result.draft[key]}</p>
        {key === 'record' && <>
          <label className="controls">기록표 빈 행 수<select value={result.draft.recordingTable.rowCount}
            onChange={event => editDraft({ recordingTable: { ...result.draft.recordingTable, rowCount: Number(event.target.value) } })}>
            {[2, 3, 4, 5, 6, 7, 8].map(count => <option key={count} value={count}>{count}</option>)}
          </select></label>
          {!validColumns && <p role="status">기록표 열 제목을 입력하고 중복을 없애 주세요.</p>}
          <table className="record-table"><caption>학생 관찰·측정 기록표</caption><thead><tr>
            {result.draft.recordingTable.columns.map((column, index) => <th key={index} scope="col">
              <input className="controls" aria-label={`기록표 열 ${index + 1}`} maxLength={60} value={column}
                onChange={event => editDraft({ recordingTable: { ...result.draft.recordingTable,
                  columns: result.draft.recordingTable.columns.map((item, i) => i === index ? event.target.value : item) } })}/>
              <span className="print-content">{column}</span>
            </th>)}
          </tr></thead><tbody>{Array.from({ length: result.draft.recordingTable.rowCount }, (_, row) => <tr key={row}>
            {columns.map((_, column) => <td key={column}></td>)}
          </tr>)}</tbody></table>
        </>}
      </section>)}
      <h3>시간 배분</h3>
      <p>계획 {plannedMinutes}분 · 단계 합계 {phaseMinutes}분</p>
      {!validTiming && <p role="status">각 활동을 입력하고 단계별 분 합계를 계획 시간에 맞춰 주세요.</p>}
      <ol>{result.draft.phases.map((phase, index) => {
        const start = result.draft.phases.slice(0, index).reduce((sum, item) => sum + item.minutes, 0);
        const interval = validTiming ? `${start}–${start + phase.minutes}분` : '';
        return <li key={index}>
          <div className="grid controls">
            <label>{index + 1}단계 활동<input maxLength={500} value={phase.activity}
              onChange={event => editDraft({ phases: result.draft.phases.map((item, i) => i === index
                ? { ...item, activity: event.target.value } : item) })}/></label>
            <label>{index + 1}단계 시간(분)<input type="number" min="1" max={plannedMinutes} value={phase.minutes || ''}
              onChange={event => editDraft({ phases: result.draft.phases.map((item, i) => i === index
                ? { ...item, minutes: Number(event.target.value) } : item) })}/></label>
            <button type="button" className="secondary" disabled={result.draft.phases.length === 1}
              onClick={() => editDraft({ phases: result.draft.phases.filter((_, i) => i !== index) })}>단계 삭제</button>
          </div>
          {interval && <span className="controls">수업 시작 기준 {interval}</span>}
          <span className="print-content">{phase.activity} ({phase.minutes}분){interval && ` · ${interval}`}</span>
        </li>;
      })}</ol>
      <button type="button" className="controls" disabled={result.draft.phases.length >= plannedMinutes}
        onClick={() => editDraft({ phases: [...result.draft.phases, { activity: '', minutes: 0 }] })}>활동 단계 추가</button>
      <h3>교과서 근거</h3>
      <p>교과서 연계 생성 불가 · 이 초안에는 교과서 자료나 쪽수·차시 출처가 포함되지 않았습니다.</p>
      <button className="controls" disabled={busy || databaseStatus !== 'ready' || !editor.title.trim() || !validTiming || !validColumns}
        onClick={() => void saveCurrentPlan()}>{busy ? '저장 중…' : editorId ? '수업안 수정 저장' : '수업안 저장'}</button>
      <button className="controls" disabled={!validTiming || !validColumns} onClick={() => window.print()}>인쇄 / PDF 저장</button>
    </article>}
  </>;
}
