import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = new URL('./out/', import.meta.url);
await mkdir(output, { recursive: true });
const screenshots = await Promise.all(['before', 'after', 'video-plan'].map(async name =>
  'data:image/png;base64,' + (await readFile(new URL(`../screenshots/mobile-${name}.png`, import.meta.url))).toString('base64')));
const processScenes = [
  ['과학 탐구 수업 설계기', ['과정 영상', '2022 개정 성취기준을 수업 설계의 기준으로'], null],
  ['근거 확인', ['교육부 고시 별책 9와 성취기준 87건 대조', '교과서 단원·인쇄 쪽수·차시를 별도로 확인'], null],
  ['수정 전 · 모바일 가로 넘침', ['긴 교과서 항목으로 화면이 넓어짐', '360px 환경에서 생성 버튼 탭 실패'], screenshots[0]],
  ['수정 후 · 360px 검증', ['같은 가상 자료로 다시 실행', '생성 버튼 탭 및 인쇄용 PDF 출력 통과'], screenshots[1]],
  ['오류 후 복구', ['가상 응답으로 생성·저장 실패를 재현', '재시도 후 저장본에서 수정한 목표 복원'], null],
  ['남은 검증', ['과학 1·2·3 전체 범위 및 자료 이용 조건', '실제 Supabase·OpenAI 연결과 Vercel 배포'], null],
];
const trailerScenes = [
  ['과학 탐구 수업 설계기', ['성취기준을 골라 탐구 수업안을 설계하세요'], null],
  ['교과서 근거와 수업 조건', ['판본·쪽수·차시를 확인하고 장비와 시간을 입력', '화면은 가상 자료를 이용한 로컬 시연입니다'], screenshots[1]],
  ['수업안 미리보기', ['학생이 관찰하고, 근거로 설명하고, 새 문제에 적용', '가상 수업안의 수정 결과를 PDF로 출력'], screenshots[2]],
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  for (const [name, scenes] of [['process', processScenes], ['trailer', trailerScenes]]) {
    const bytes = await page.evaluate(async ({ scenes, seconds }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      document.body.append(canvas);
      const ctx = canvas.getContext('2d');
      const images = await Promise.all(scenes.map(async ([,, url]) => {
        if (!url) return null;
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      }));
      function paint(index) {
        const [title, lines] = scenes[index];
        const img = images[index];
        const textWidth = img ? 735 : 1120;
        ctx.fillStyle = '#142c24';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#c8efd7';
        ctx.font = 'bold 50px "Malgun Gothic", sans-serif';
        ctx.fillText(title, 72, 210, textWidth);
        ctx.fillStyle = '#ffffff';
        ctx.font = '28px "Malgun Gothic", sans-serif';
        lines.forEach((line, i) => ctx.fillText(line, 74, 290 + i * 53, textWidth));
        if (img) {
          const scale = Math.min(350 / img.width, 600 / img.height);
          ctx.drawImage(img, 850, 55, img.width * scale, img.height * scale);
        }
        ctx.fillStyle = '#c8efd7';
        ctx.fillRect(72, 600, 700 * ((index + 1) / scenes.length), 4);
      }
      const stream = canvas.captureStream(0);
      const [track] = stream.getVideoTracks();
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise(resolve => { recorder.onstop = resolve; });
      paint(0);
      recorder.start();
      for (let index = 0; index < scenes.length; index++) {
        paint(index);
        track.requestFrame();
        const frames = setInterval(() => { paint(index); track.requestFrame(); }, 100);
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        clearInterval(frames);
      }
      recorder.stop();
      await done;
      stream.getTracks().forEach(track => track.stop());
      canvas.remove();
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    }, { scenes, seconds: name === 'process' ? 4 : 3 });
    const buffer = Buffer.from(bytes);
    if (buffer.subarray(0, 4).toString('hex') !== '1a45dfa3') throw Error('Invalid WebM: ' + name);
    await writeFile(new URL(name + '.webm', output), buffer);
    console.log(`${name}.webm: ${buffer.length} bytes`);
  }
} finally {
  await browser.close();
}
