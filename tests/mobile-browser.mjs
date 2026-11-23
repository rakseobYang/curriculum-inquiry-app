import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { lessonSections } from '../lib/lesson-schema.ts';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true,
    hasTouch: true, acceptDownloads: true });
  const page = await context.newPage();
  const workerRequests = [];
  const draft = {
    ...Object.fromEntries(Object.keys(lessonSections).map(key => [key, '가상 응답 검증용 초안'])),
    phases: [{ activity: '학생이 관찰 조건과 결과를 기록합니다.', minutes: 15 },
      { activity: '관찰 근거로 설명하고 새 상황에 적용합니다.', minutes: 30 }],
    recordingTable: { columns: ['조건', '관찰 결과'], rowCount: 3 },
  };
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js**', route => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: `(() => {
      let saved;
      let serial = 0;
      window.turnstile = {
        render(target, options) {
          saved = options;
          const label = document.createElement('span');
          label.textContent = '가상 Turnstile 확인';
          target.appendChild(label);
          queueMicrotask(() => options.callback('virtual-turnstile-token-' + (++serial)));
          return 'virtual-widget';
        },
        reset() { queueMicrotask(() => saved?.callback('virtual-turnstile-token-' + (++serial))); },
        remove() {},
      };
    })();`,
  }));
  await page.route('https://worker.example.invalid/**', async route => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': request.headers().origin,
      'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Content-Type',
      'content-type': 'application/json' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = request.postDataJSON();
    workerRequests.push(body);
    assert.equal(body.standardCode, '[9과01-01]');
    assert.equal(body.turnstileToken.includes('virtual-turnstile-token-'), true);
    assert.equal(Object.hasOwn(body, 'evidenceId'), false);
    if (workerRequests.length === 1) {
      return route.fulfill({ status: 502, headers, body: JSON.stringify({ status: 'model-unavailable' }) });
    }
    return route.fulfill({ status: 200, headers, body: JSON.stringify({
      status: 'generated', generationMode: 'official-curriculum-only', alignmentStatus: 'teacher-review',
      officialStandard: { code: '[9과01-01]', official_text: '가상 검사에서는 실서비스 API를 호출하지 않았습니다.',
        official_source: '가상 출처 https://example.invalid/standard' },
      designedLesson: { lesson: body.lesson, total: body.totalLessons }, plannedMinutes: body.minutes,
      plannedEquipment: body.equipment, plannedClassConditions: body.studentConditions,
      draft, references: [],
    }) });
  });

  await page.goto(process.env.BROWSER_TEST_URL);
  await page.getByRole('heading', { name: '과학 탐구 수업 설계기' }).waitFor();
  await page.getByText(/저장한 수업안은 이 브라우저의 IndexedDB에만/).waitFor();
  await page.getByText('아직 이 브라우저에 저장된 수업안이 없습니다.').waitFor();
  assert.equal(await page.getByLabel('교사 이메일').count(), 0, 'the app opens without login');
  assert.equal(await page.getByRole('heading', { name: '내 수업안 · 이 브라우저' }).count(), 1);

  const workerUrl = await page.evaluate(() => [...document.scripts].map(script => script.src)
    .find(src => src.includes('/curriculum-inquiry-app/_next/')));
  assert.ok(workerUrl, 'static asset URLs include the GitHub Pages subpath');
  const standardSearch = page.getByLabel('성취기준 검색');
  await standardSearch.fill('없는 기준');
  await page.getByText('검색 결과가 없습니다.').waitFor();
  await standardSearch.fill('9과01-01');
  const standardSelect = page.getByLabel('2022 개정 중학교 과학 성취기준');
  await standardSelect.selectOption('[9과01-01]');
  await page.getByText('교육과정 공식 원문 · 2022 개정').waitFor();
  await page.getByText('교과서 연계 생성 불가').first().waitFor();
  await page.getByText(/과학 3 자료는 2015 개정 참고 자료/).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const generate = page.getByRole('button', { name: '교육과정 기반 AI 초안 생성' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some(button => button.textContent?.includes('교육과정 기반 AI 초안 생성') && !button.disabled));
  await page.getByLabel('설계할 차시').fill('2');
  await page.getByLabel('전체 차시').fill('4');
  await page.getByLabel('수업 시간(분)').fill('45');
  await page.getByLabel('사용 가능한 장비').fill('온도계');
  await page.getByLabel('학급 조건').fill('4명씩 모둠');

  await generate.click();
  await page.getByRole('alert').getByText(/가짜 응답으로 대체하지 않았습니다/).waitFor();
  assert.equal(workerRequests.length, 1, 'first virtual response reports model failure without fallback');
  await generate.click();
  await page.getByText('실제 AI 초안입니다. 공식 교육과정 기반이며 교과서와 연계하지 않았습니다.').waitFor();
  assert.equal(workerRequests.length, 2);
  assert.equal(workerRequests[1].lesson, 2);
  assert.equal(workerRequests[1].totalLessons, 4);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 360), true);

  const objective = page.getByLabel('학습 목표', { exact: true });
  const contentCheck = page.getByRole('checkbox', { name: /학습 목표와 핵심 개념/ });
  await contentCheck.check();
  assert.equal(await contentCheck.isChecked(), true, 'the teacher review checkbox can be selected');
  await objective.fill('교사가 수정한 목표');
  await page.waitForFunction(() => {
    const input = [...document.querySelectorAll('input[type="checkbox"]')]
      .find(element => element.parentElement?.textContent?.includes('학습 목표와 핵심 개념'));
    return input instanceof HTMLInputElement && !input.checked;
  });
  await page.getByLabel('기록표 열 2').fill('관찰 자료');
  await page.getByLabel('기록표 빈 행 수').selectOption('4');
  const save = page.getByRole('button', { name: '수업안 저장' });
  await save.click();
  await page.getByText('이 브라우저에 수업안을 저장했습니다.').waitFor();
  await page.getByLabel('수업안 제목').fill('저장·백업 검증 수업안');
  await page.getByRole('button', { name: '수업안 수정 저장' }).click();
  await page.getByText('이 브라우저에 수업안을 저장했습니다.').waitFor();
  await page.reload();
  await page.getByRole('button', { name: '열기', exact: true }).waitFor();
  await page.getByLabel('저장한 수업안 검색').fill('없는 제목');
  await page.getByText('검색 결과가 없습니다.').waitFor();
  await page.getByLabel('저장한 수업안 검색').fill('저장·백업');
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await page.getByText('브라우저에 저장된 수업안을 열었습니다.').waitFor();
  assert.equal(await objective.inputValue(), '교사가 수정한 목표');
  assert.equal(await page.getByLabel('기록표 열 2').inputValue(), '관찰 자료');

  await mkdir('test-results', { recursive: true });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '백업 다운로드' }).click();
  const download = await downloadEvent;
  const backupPath = 'test-results/virtual-browser-backup.json';
  await download.saveAs(backupPath);
  assert.match(download.suggestedFilename(), /curriculum-inquiry-backup-.*\.json/u);
  const deleteDialog = page.waitForEvent('dialog').then(dialog => dialog.accept());
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await deleteDialog;
  await page.getByText('아직 이 브라우저에 저장된 수업안이 없습니다.').waitFor();
  const restoreDialog = page.waitForEvent('dialog').then(dialog => dialog.accept());
  await page.getByLabel('백업 복원').setInputFiles(backupPath);
  await restoreDialog;
  await page.getByText('1개 수업안을 이 브라우저에 복원했습니다.').waitFor();
  await page.getByRole('button', { name: '열기', exact: true }).click();

  await page.emulateMedia({ media: 'print' });
  await page.getByText(/교사 내용 검토 필요/).waitFor();
  await page.getByText(/교과서 연계 생성 불가/).last().waitFor();
  await page.locator('.print-content').filter({ hasText: '교사가 수정한 목표' }).waitFor();
  const pdf = await page.pdf({ path: 'test-results/mobile-fixture.pdf', format: 'A4' });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  console.log('Edge 360px: no-login entry, standard search, mocked Worker outcomes, IndexedDB CRUD, backup/restore, print, and Pages subpath passed');
  await context.close();
} finally {
  await browser.close();
}
