import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { lessonSections } from '../lib/lesson-generation.ts';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  let available = false;
  let failLookup = true;
  let expireLookup = false;
  let user = 'teacher-one';
  let expired = false;
  let generationAttempts = 0;
  let saveAttempts = 0;
  let updateAttempts = 0;
  let failSavedList = true;
  let savedPlan;
  const source = { id: 'test-ref', volume: 3, revision: '2015', edition_id: '테스트 판본',
    unit_id: '테스트 단원', lesson: 2, lesson_end: 3, total_unit_lessons: 3, lesson_basis: 'publisher',
    printed_page_start: 14, printed_page_end: 18, generation_available: true,
    alignment_scope: '가상 검증 범위', supports_entire_standard: false,
    source_url: 'https://example.invalid/reference/' + 'long-source-path'.repeat(18) };
  const unassignedSource = { ...source, id: 'test-unassigned', lesson: null,
    lesson_end: null, total_unit_lessons: null, lesson_basis: 'unassigned' };
  const displayOnlySource = { ...source, id: 'test-display-only', generation_available: false };
  await page.route('https://db.example.invalid/**', route => {
    const headers = { 'access-control-allow-origin': '*',
      'access-control-allow-headers': 'apikey, authorization, content-type, prefer',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = new URL(route.request().url()).pathname;
    if (path === '/rest/v1/rpc/find_textbook_evidence' && expireLookup) {
      expireLookup = false;
      return route.fulfill({ status: 401, json: {}, headers });
    }
    if (path === '/rest/v1/rpc/find_textbook_evidence' && failLookup) {
      failLookup = false;
      return route.fulfill({ status: 503, json: {}, headers });
    }
    if (path === '/auth/v1/logout') {
      assert.equal(new URL(route.request().url()).searchParams.get('scope'), 'local');
      assert.equal(route.request().headers().authorization, 'Bearer test-session');
      return route.fulfill({ status: 204, headers });
    }
    if (path === '/rest/v1/lesson_plans') {
      if (failSavedList && new URL(route.request().url()).searchParams.has('order')) {
        failSavedList = false;
        return route.fulfill({ status: 503, json: {}, headers });
      }
      if (route.request().method() === 'POST') {
        const plan = route.request().postDataJSON();
        assert.match(route.request().headers().prefer, /resolution=merge-duplicates/);
        if (savedPlan) assert.equal(plan.id, savedPlan.id);
        savedPlan = plan;
        if (++saveAttempts === 1) return route.fulfill({ status: 503, json: {}, headers });
      }
      if (route.request().method() === 'PATCH') {
        assert.equal(new URL(route.request().url()).searchParams.get('id'), 'eq.' + savedPlan.id);
        updateAttempts++;
        savedPlan = { ...savedPlan, ...route.request().postDataJSON() };
      }
      return route.fulfill({ json: savedPlan ? [savedPlan] : [], headers });
    }
    const payload = {
    '/auth/v1/token': { access_token: 'test-session', user: { id: user } },
      '/rest/v1/curriculum_standards': [{ code: 'TEST', official_text: '테스트 성취기준', official_source: '테스트 출처' }],
      '/rest/v1/rpc/find_textbook_evidence': available ? [source, unassignedSource, displayOnlySource] : [],
    }[path];
    return route.fulfill({ json: payload ?? null, status: payload ? 200 : 404,
      headers });
  });
  await page.route('**/api/lessons/generate', route => expired
    ? route.fulfill({ status: 401, json: { status: 'unauthorized' } })
    : ++generationAttempts === 1
    ? route.fulfill({ status: 502, json: { status: 'model-unavailable' } })
    : generationAttempts === 2
    ? route.fulfill({ status: 502, json: { status: 'model-output-invalid' } })
    : route.fulfill({ json: {
    status: 'generated', designedLesson: { lesson: 3, total: 3 }, plannedMinutes: 45, plannedEquipment: ['초시계', '줄자'],
    plannedClassConditions: '4명씩 모둠',
    officialStandard: { code: 'TEST', official_text: '생성에 사용한 원문', official_source: '생성에 사용한 출처 https://example.invalid/official-standard' },
    draft: { ...Object.fromEntries(Object.keys(lessonSections).map(key => [key, '테스트 초안'])),
      phases: [{ activity: '테스트 활동', minutes: 15 }, { activity: '결과 설명', minutes: 30 }],
      recordingTable: { columns: ['시간 (분)', '관찰'], rowCount: 3 } },
    references: [{ id: source.id, volume: 3, revision: '2015', editionId: source.edition_id,
      unitId: source.unit_id, lesson: 2, lessonEnd: 3, lessonBasis: 'publisher', printedPages: [14, 18],
      alignmentScope: source.alignment_scope, supportsEntireStandard: false, sourceUrl: source.source_url }],
  } }));
  await page.goto(process.env.BROWSER_TEST_URL ?? 'http://127.0.0.1:3219');
  await page.getByRole('heading', { name: '과학 탐구 수업 설계기' }).waitFor();
  await page.getByLabel('교사 이메일').fill('teacher@example.invalid');
  await page.getByLabel('비밀번호').fill('test-password');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('button', { name: '저장 목록 다시 불러오기' }).click();
  await page.getByText('저장한 수업안 목록을 불러오지 못했습니다.').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    const timeout = AbortSignal.timeout;
    AbortSignal.timeout = milliseconds => {
      if (milliseconds !== 10000) return timeout(milliseconds);
      AbortSignal.timeout = timeout;
      return AbortSignal.abort(new DOMException('Simulated lookup timeout', 'TimeoutError'));
    };
  });
  await page.getByRole('combobox').selectOption('TEST', { timeout: 8000 });
  await page.getByRole('alert').getByText('교과서 근거를 불러오지 못했습니다.').waitFor();
  assert.equal(await page.getByRole('button', { name: '수업안 생성' }).isDisabled(), true);
  await page.getByRole('button', { name: '다시 조회' }).press('Enter');
  await page.getByRole('alert').getByText('교과서 근거를 불러오지 못했습니다.').waitFor();
  assert.equal(failLookup, false);
  await page.getByRole('button', { name: '다시 조회' }).press('Enter');
  await page.getByText(/현재 표시할 수 있는 자료가 없습니다/).waitFor();
  await page.getByText('수업에 사용할 교과서 근거 미확보', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '수업안 생성' }).isDisabled(), true);
  await page.getByLabel('성취기준 검색').fill('없는 코드');
  await page.getByText('검색 결과가 없습니다.').waitFor();
  await page.getByLabel('성취기준 검색').fill('［te st］');
  await page.getByText('검색 결과가 없습니다.').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  available = true;
  await page.getByLabel('성취기준 검색').clear();
  await page.getByRole('combobox').selectOption('');
  await page.getByRole('combobox').selectOption('TEST');
  await page.getByRole('combobox').nth(1).selectOption(source.id);
  await page.getByText('교과서 근거 3구간 · 수업안 생성 가능 2구간', { exact: true }).waitFor();
  await page.getByLabel('교과서 판본·단원·차시').selectOption(displayOnlySource.id);
  await page.getByText(/이 근거의 API 전송은 승인되지 않았습니다/).waitFor();
  assert.equal(await page.getByRole('button', { name: '수업안 생성' }).isDisabled(), true);
  await page.getByRole('button', { name: '과학 1', exact: true }).press('Enter');
  await page.getByText('선택한 교과서에서 표시할 수 있는 근거가 없습니다.').waitFor();
  assert.equal(await page.getByRole('button', { name: '수업안 생성' }).isDisabled(), true);
  await page.getByRole('button', { name: '과학 3', exact: true }).press('Enter');
  await page.getByLabel('교과서 판본·단원·차시').selectOption(unassignedSource.id);
  await page.getByLabel('설계할 차시').fill('4');
  await page.getByLabel('전체 차시 (교사 입력)').fill('3');
  await page.getByRole('button', { name: '수업안 생성' }).press('Enter');
  await page.getByText('설계할 차시는 전체 차시 이내로 입력해 주세요.').waitFor();
  assert.equal(generationAttempts, 0);
  await page.getByRole('combobox').nth(1).selectOption(source.id);
  await page.getByLabel('설계할 차시').fill('3');
  await page.getByLabel('설계할 차시').blur();
  const generateButton = page.getByRole('button', { name: '수업안 생성' });
  if (process.env.CAPTURE_MOBILE) {
    await mkdir('screenshots', { recursive: true });
    await page.screenshot({ path: 'screenshots/mobile-' + process.env.CAPTURE_MOBILE + '.png', fullPage: true });
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360), 'content fits the 360px viewport');
  await generateButton.evaluate(button => button.scrollIntoView({ block: 'center' }));
  await page.evaluate(() => {
    const timeout = AbortSignal.timeout;
    AbortSignal.timeout = milliseconds => {
      if (milliseconds !== 60000) return timeout(milliseconds);
      AbortSignal.timeout = timeout;
      return AbortSignal.abort(new DOMException('Simulated timeout', 'TimeoutError'));
    };
  });
  await generateButton.tap({ timeout: 5000 });
  await page.getByRole('alert').getByText(/수업안 생성 응답 시간이 초과됐습니다/).waitFor();
  assert.equal(await page.getByLabel('설계할 차시').inputValue(), '3');
  assert.equal(generationAttempts, 0);
  await generateButton.tap({ timeout: 5000 });
  await page.getByRole('alert').getByText(/AI 생성 서비스에 연결하지 못했습니다/).waitFor();
  assert.equal(await page.getByLabel('설계할 차시').inputValue(), '3');
  await page.getByLabel('사용 가능 장비').fill('초시계, 줄자');
  await page.getByLabel('학급 조건').fill('4명씩 모둠');
  await generateButton.tap({ timeout: 5000 });
  await page.getByRole('alert').getByText(/초안의 시간 배분 또는 근거를 검증하지 못했습니다/).waitFor();
  assert.equal(await page.getByLabel('사용 가능 장비').inputValue(), '초시계, 줄자');
  assert.equal(await page.getByLabel('학급 조건').inputValue(), '4명씩 모둠');
  await generateButton.tap({ timeout: 5000 });
  const objective = page.getByLabel('학습 목표', { exact: true });
  const contentCheck = page.getByRole('checkbox', { name: /학습 목표와 핵심 개념/ });
  await contentCheck.check();
  await page.getByText('교사 확인 1/4개', { exact: true }).waitFor();
  await objective.fill('수정한 탐구 목표');
  await page.getByLabel('기록표 열 2').fill('관찰 결과');
  await page.getByLabel('기록표 빈 행 수').selectOption('4');
  assert.equal(await contentCheck.isChecked(), false);
  await page.getByText('교사 확인 0/4개', { exact: true }).waitFor();
  await contentCheck.check();
  const save = page.getByRole('button', { name: '수업안 저장' });
  await page.getByRole('button', { name: '활동 단계 추가' }).click();
  await page.getByLabel('3단계 활동').waitFor();
  assert.equal(await save.isDisabled(), true);
  await page.getByRole('button', { name: '3단계 삭제' }).click();
  assert.equal(await save.isEnabled(), true);
  const secondColumn = page.getByLabel('기록표 열 2');
  await secondColumn.fill(' ');
  assert.equal(await save.isDisabled(), true);
  await secondColumn.fill(await page.getByLabel('기록표 열 1').inputValue());
  assert.equal(await page.getByRole('button', { name: '인쇄 / PDF 저장' }).isDisabled(), true);
  await secondColumn.fill('관찰 결과');
  await page.getByLabel('1단계 시간(분)').fill('14');
  assert.equal(await save.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '인쇄 / PDF 저장' }).isDisabled(), true);
  await page.getByLabel('2단계 시간(분)').fill('31');
  await page.getByLabel('1단계 활동').fill('수정한 시간 배분 활동');
  await page.getByLabel('교사 점검 메모').fill('모둠별 관찰 기록을 근거로 설명하는지 확인');
  await contentCheck.check();
  await save.tap({ timeout: 5000 });
  await page.getByRole('alert').getByText(/저장하지 못했습니다/).waitFor();
  assert.equal(await objective.inputValue(), '수정한 탐구 목표');
  await save.tap({ timeout: 5000 });
  await page.getByText('수업안을 저장했습니다.', { exact: true }).waitFor();
  assert.equal(savedPlan.editor_state.result.draft.objective, '수정한 탐구 목표');
  assert.equal(savedPlan.editor_state.verifiedChecks.content, true);
  await objective.fill('저장하지 않은 편집');
  await page.getByText('저장하지 않은 변경 사항이 있습니다.', { exact: true }).waitFor();
  const departureBlocked = () => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  assert.equal(await departureBlocked(), true);
  const reloadWarning = page.waitForEvent('dialog', { timeout: 5000 });
  await page.evaluate(() => setTimeout(() => location.reload(), 0));
  const warning = await reloadWarning;
  assert.equal(warning.type(), 'beforeunload');
  await warning.dismiss();
  assert.equal(await objective.inputValue(), '저장하지 않은 편집');
  const savedSearch = page.getByLabel('저장한 수업안 제목 검색');
  await savedSearch.fill('없는 수업안');
  await page.getByText('검색한 제목의 수업안이 없습니다.').waitFor();
  await savedSearch.fill('test');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: /탐구 수업안 열기/ }).tap({ timeout: 5000 });
  assert.equal(await objective.inputValue(), '저장하지 않은 편집');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: /탐구 수업안 열기/ }).tap({ timeout: 5000 });
  await page.getByText('저장한 수업안을 열었습니다.').waitFor();
  assert.equal(await page.getByRole('link', { name: '생성 당시 교육부 고시 열기' }).getAttribute('href'),
    'https://example.invalid/official-standard');
  await page.getByText('현재 수업안이 저장되어 있습니다.', { exact: true }).waitFor();
  assert.equal(await departureBlocked(), false);
  assert.equal(await objective.inputValue(), '수정한 탐구 목표');
  assert.equal(await contentCheck.isChecked(), true);
  await savedSearch.clear();
  await page.getByLabel('수업안 제목', { exact: true }).fill('개정한 실험 수업안');
  await save.tap({ timeout: 5000 });
  await page.getByText('수업안을 저장했습니다.', { exact: true }).waitFor();
  assert.equal(updateAttempts, 1);
  assert.equal(saveAttempts, 2);
  assert.equal(await page.getByRole('button', { name: /수업안 열기/ }).count(), 1);
  await page.getByRole('button', { name: '개정한 실험 수업안 열기' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.emulateMedia({ media: 'print' });
  await page.getByText('수업 설계 · AI 생성 초안과 교사가 편집한 내용', { exact: true }).waitFor();
  await page.getByText('교사 확인 1/4개', { exact: true }).waitFor();
  await page.getByText('교사 점검 메모 · 모둠별 관찰 기록을 근거로 설명하는지 확인', { exact: true }).waitFor();
  await page.getByRole('heading', { name: '개정한 실험 수업안' }).waitFor();
  await page.locator('p.print-content').getByText('수정한 탐구 목표', { exact: true }).waitFor();
  await page.getByText(/설계 범위 3차시 중 3차시/).waitFor();
  await page.getByText('교과서 부분 근거 사용', { exact: true }).waitFor();
  await page.getByText('입력한 장비 초시계, 줄자', { exact: true }).waitFor();
  await page.getByText('입력한 학급 조건 4명씩 모둠', { exact: true }).waitFor();
  await page.getByText(/14–18쪽, 2–3차시/).waitFor();
  await page.getByText(/과학 3 \(2015 개정, 내용 참고\), 테스트 판본, 테스트 단원/).waitFor();
  await page.getByText('생성에 사용한 원문', { exact: false }).waitFor();
  await page.getByText('성취기준 부분 근거 · 가상 검증 범위', { exact: true }).filter({ visible: true }).waitFor();
  await page.getByText(source.source_url, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByText('수정한 시간 배분 활동 (14분) · 0–14분', { exact: true }).waitFor();
  await page.getByText('결과 설명 (31분) · 14–45분', { exact: true }).waitFor();
  const recordTable = page.getByRole('table', { name: '학생 관찰·측정 기록표' });
  await recordTable.getByRole('columnheader', { name: '관찰 결과' }).waitFor();
  assert.deepEqual(await recordTable.getByRole('cell').allTextContents(), Array(8).fill(''));
  await page.getByText(/교사 확인 · 학습 목표와 핵심 개념/).waitFor();
  assert.equal(await page.getByRole('button', { name: '수업안 저장' }).isVisible(), false);
  await mkdir('test-results', { recursive: true });
  if (process.env.CAPTURE_VIDEO) {
    await page.locator('p.print-content').getByText('수정한 탐구 목표', { exact: true }).evaluate(
      target => target.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: 'screenshots/mobile-video-plan.png' });
  }
  const pdf = await page.pdf({ path: 'test-results/mobile-fixture.pdf', format: 'A4' });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await page.emulateMedia({ media: 'screen' });
  expireLookup = true;
  const standardSelect = page.locator('form').getByRole('combobox').first();
  await standardSelect.selectOption('');
  await standardSelect.selectOption('TEST');
  await page.getByText('로그인 시간이 만료됐습니다. 다시 로그인해 주세요.').waitFor();
  assert.equal(await objective.count(), 0);
  await page.getByLabel('교사 이메일').fill('teacher@example.invalid');
  await page.getByLabel('비밀번호').fill('test-password');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  assert.equal(await objective.inputValue(), '수정한 탐구 목표');
  const sourceSelect = page.getByLabel('교과서 판본·단원·차시');
  assert.equal(await sourceSelect.inputValue(), '');
  await sourceSelect.selectOption(source.id);
  expired = true;
  await generateButton.press('Enter');
  await page.getByLabel('교사 이메일').waitFor();
  assert.equal(await objective.isVisible(), false);
  user = 'teacher-two';
  savedPlan = undefined;
  await page.getByLabel('교사 이메일').fill('another@example.invalid');
  await page.getByLabel('비밀번호').fill('test-password');
  await page.getByRole('button', { name: '로그인', exact: true }).press('Enter');
  await page.getByRole('combobox').waitFor();
  assert.equal(await objective.count(), 0);
  assert.equal(await page.getByRole('button', { name: /탐구 수업안 열기/ }).count(), 0);
  await page.getByRole('button', { name: '로그아웃', exact: true }).press('Enter');
  await page.getByText('로그아웃했습니다.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('교사 이메일').isVisible(), true);
  assert.equal(await page.getByRole('combobox').count(), 0);
  console.log('Edge 360px: generation and save retries, reopen, page width, print layout and PDF fixture passed');
} finally {
  await browser.close();
}
